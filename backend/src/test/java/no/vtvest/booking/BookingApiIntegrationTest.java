package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

class BookingApiIntegrationTest extends IntegrationTest {

    private ResultActions create(String email, String json) throws Exception {
        return mvc.perform(post("/api/bookings")
                .with(as(email))
                .with(withCsrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json));
    }

    private static RequestPostProcessor as(String email) {
        return user(email);
    }

    @Test
    void directBookingIsApprovedAndOverlapsAreRejected() throws Exception {
        create(KARI, bookingJson(ROOM_A, ORG_A, "Styremøte", at(7, 8), at(7, 9)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.organizationName").value("Organisasjon A"));

        create(OLA, bookingJson(ROOM_A, ORG_B, "Kolliderer", at(7, 8).plus(30, ChronoUnit.MINUTES), at(7, 10)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT"));

        // Back-to-back is allowed (half-open intervals).
        create(OLA, bookingJson(ROOM_A, ORG_B, "Rett etter", at(7, 9), at(7, 10)))
                .andExpect(status().isCreated());
    }

    @Test
    void bookingPastMidnightConflictsWithBookingsTheNextDay() throws Exception {
        create(KARI, bookingJson(ROOM_A, ORG_A, "Nattarrangement", at(7, 22), at(8, 2)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("APPROVED"));

        create(OLA, bookingJson(ROOM_A, ORG_B, "Tidlig møte", at(8, 1), at(8, 3)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT"));

        create(OLA, bookingJson(ROOM_A, ORG_B, "Etterpå", at(8, 2), at(8, 3)))
                .andExpect(status().isCreated());

        // The 12-hour limit still applies across midnight.
        create(KARI, bookingJson(ROOM_A, ORG_A, "For lang", at(9, 20), at(10, 9)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("RULE_VIOLATION"));
    }

    @Test
    void requestPermissionCreatesPendingRequestThatDoesNotBlock() throws Exception {
        create(KARI, bookingJson(STORSALEN, ORG_A, "Seminar", at(7, 12), at(7, 14)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.requiresApproval").value(true));

        // Pending requests do not reserve the slot, so a competing request is allowed.
        create(OLA, bookingJson(STORSALEN, ORG_B, "Allmøte", at(7, 12), at(7, 14)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"));
    }

    @Test
    void permissionAndMembershipAreEnforced() throws Exception {
        create(OLA, bookingJson(ROOM_B, ORG_B, "Møte", at(7, 8), at(7, 9)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NO_PERMISSION"));

        create(OLA, bookingJson(ROOM_A, ORG_A, "Møte", at(7, 8), at(7, 9)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_MEMBER"));

        create(ADMIN, bookingJson(ROOM_A, ORG_A, "Møte", at(7, 8), at(7, 9)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_MEMBER"));

        create(KARI, bookingJson(UUID.randomUUID(), ORG_A, "Møte", at(7, 8), at(7, 9)))
                .andExpect(status().isNotFound());
    }

    @Test
    void invalidInputIsRejected() throws Exception {
        create(KARI, bookingJson(ROOM_A, ORG_A, "Feil rekkefølge", at(7, 10), at(7, 9)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION"));
        create(KARI, bookingJson(ROOM_A, ORG_A, "Fortid", at(-1, 10), at(-1, 11)))
                .andExpect(status().isBadRequest());
        create(KARI, bookingJson(ROOM_A, ORG_A, "For lang", at(7, 0), at(7, 13)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("RULE_VIOLATION"));
        create(KARI, bookingJson(ROOM_A, ORG_A, "For langt frem", at(200, 8), at(200, 9)))
                .andExpect(status().isUnprocessableContent());
        create(KARI, bookingJson(ROOM_A, ORG_A, "x".repeat(81), at(7, 8), at(7, 9)))
                .andExpect(status().isBadRequest());
        create(KARI, bookingJson(ROOM_A, ORG_A, "  ", at(7, 8), at(7, 9)))
                .andExpect(status().isBadRequest());
        create(KARI, "{not json")
                .andExpect(status().isBadRequest());
    }

    @Test
    void clientSuppliedIdentityAndStatusAreIgnored() throws Exception {
        String json = """
                {"roomId":"%s","organizationId":"%s","title":"Forsøk","start":"%s","end":"%s",
                 "requestedById":"%s","status":"APPROVED","requiresApproval":false}
                """.formatted(STORSALEN, ORG_B, at(7, 12), at(7, 13), ADMIN_ID);

        create(OLA, json)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"));

        UUID requester = jdbc.queryForObject("SELECT requested_by_id FROM bookings", UUID.class);
        assertThat(requester).isEqualTo(OLA_ID);
    }

    @Test
    void pendingRequestsAreOnlyVisibleToOwnOrganizationAndAdmins() throws Exception {
        String body = create(KARI, bookingJson(STORSALEN, ORG_A, "Hemmelig søknad", at(7, 12), at(7, 13)))
                .andReturn().getResponse().getContentAsString();
        String id = body.replaceAll(".*\"id\":\"([^\"]+)\".*", "$1");
        create(KARI, bookingJson(ROOM_A, ORG_A, "Bekreftet", at(7, 8), at(7, 9)));

        String from = at(6, 0).toString();
        String to = at(9, 0).toString();

        mvc.perform(get("/api/bookings").param("from", from).param("to", to).with(as(OLA)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].title").value("Bekreftet"))
                .andExpect(jsonPath("$[0].description").doesNotExist());
        mvc.perform(get("/api/bookings/" + id).with(as(OLA))).andExpect(status().isNotFound());

        mvc.perform(get("/api/bookings").param("from", from).param("to", to).with(as(KARI)))
                .andExpect(jsonPath("$.length()").value(2));
        mvc.perform(get("/api/bookings/" + id).with(as(ADMIN))).andExpect(status().isOk());
    }

    @Test
    void calendarRangeIsCapped() throws Exception {
        Instant from = at(0, 0);
        mvc.perform(get("/api/bookings")
                        .param("from", from.toString())
                        .param("to", from.plus(63, ChronoUnit.DAYS).toString())
                        .with(as(KARI)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void roomsIncludeTheUsersEffectivePermissions() throws Exception {
        mvc.perform(get("/api/rooms").with(as(KARI)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[?(@.name == 'Møterom B')].permissions[0].permission").value("REQUEST"));
    }

    @Test
    void requestsWithoutSessionOrCsrfAreRefused() throws Exception {
        mvc.perform(get("/api/rooms")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/bookings")
                        .with(as(KARI))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson(ROOM_A, ORG_A, "Uten CSRF", at(7, 8), at(7, 9))))
                .andExpect(status().isForbidden());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM bookings", Integer.class)).isZero();
    }
}
