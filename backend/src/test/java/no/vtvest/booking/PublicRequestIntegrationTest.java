package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/** The public request form (/soknad) and how a system admin handles the requests. */
class PublicRequestIntegrationTest extends IntegrationTest {

    private static final UUID ORG_C = UUID.fromString("10000000-0000-0000-0000-00000000000c");

    private static String requestJson(Instant start, Instant end) {
        return """
                {"email":" Leder@Example.TEST ","organizationName":"Ekstern forening","eventName":" Hagekonsert ","memberOfKulturstyretOrSamfunnet":true,
                 "preferredArea":"TORGALLMENNINGEN","start":"%s","end":"%s","description":"Konsert i hagen","needsVillaGuard":true}
                """.formatted(start, end);
    }

    /** Without logging in, exactly like the public form. */
    private ResultActions submitAnonymously(String json) throws Exception {
        return mvc.perform(post("/api/public/requests").with(withCsrf())
                .contentType(MediaType.APPLICATION_JSON).content(json));
    }

    private UUID submit(Instant start, Instant end) throws Exception {
        submitAnonymously(requestJson(start, end)).andExpect(status().isNoContent());
        return jdbc.queryForObject("SELECT id FROM public_requests ORDER BY created_at DESC LIMIT 1", UUID.class);
    }

    private String requestStatus(UUID id) {
        return jdbc.queryForObject("SELECT status FROM public_requests WHERE id = ?", String.class, id);
    }

    @Test
    void anyoneCanSubmitWithoutLoggingInButNotWithoutCsrf() throws Exception {
        UUID id = submit(at(7, 18), at(8, 0));

        assertThat(jdbc.queryForMap("SELECT * FROM public_requests WHERE id = ?", id))
                .containsEntry("email", "leder@example.test")
                .containsEntry("organization_name", "Ekstern forening")
                .containsEntry("event_name", "Hagekonsert")
                .containsEntry("member_of_kulturstyret_or_samfunnet", true)
                .containsEntry("needs_villa_guard", true)
                .containsEntry("preferred_area", "TORGALLMENNINGEN")
                .containsEntry("status", "NEW");

        mvc.perform(post("/api/public/requests").contentType(MediaType.APPLICATION_JSON).content(requestJson(at(7, 18), at(7, 20))))
                .andExpect(status().isForbidden());
    }

    @Test
    void invalidRequestsAreRefused() throws Exception {
        submitAnonymously(requestJson(at(7, 20), at(7, 18))).andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(-1, 18), at(-1, 20))).andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 0), at(8, 2))).andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20)).replace("Leder@Example.TEST", "ikke-epost"))
                .andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20)).replace("\"needsVillaGuard\":true", "\"needsVillaGuard\":null"))
                .andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20)).replace(" Hagekonsert ", " ")).andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20)).replace(" Hagekonsert ", "x".repeat(81))).andExpect(status().isBadRequest());
        // The area is required, and only the two common areas or no preference are accepted.
        submitAnonymously(requestJson(at(7, 18), at(7, 20)).replace("\"preferredArea\":\"TORGALLMENNINGEN\",", ""))
                .andExpect(status().isBadRequest());
        submitAnonymously(requestJson(at(7, 18), at(7, 20)).replace("TORGALLMENNINGEN", "KJELLEREN"))
                .andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public_requests", Integer.class)).isZero();
    }

    @Test
    void requestsAtMost180DaysAhead() throws Exception {
        submitAnonymously(requestJson(at(179, 18), at(179, 20))).andExpect(status().isNoContent());
        submitAnonymously(requestJson(at(181, 18), at(181, 20)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION"));
        // Beyond what PostgreSQL can store: refused before it gets there (it used to give 500).
        Instant farFuture = Instant.parse("+300000-01-01T18:00:00Z");
        submitAnonymously(requestJson(farFuture, farFuture.plusSeconds(7200)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM public_requests", Integer.class)).isOne();
    }

    @Test
    void theCountIsTheUnhandledRequestsForSystemAdminsOnly() throws Exception {
        call(get("/api/admin/public-requests/count"), ADMIN, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(0));
        UUID rejected = submit(at(7, 18), at(7, 20));
        submit(at(8, 18), at(8, 20));
        submit(at(9, 18), at(9, 20));
        call(post("/api/admin/public-requests/" + rejected + "/reject"), ADMIN, null).andExpect(status().isOk());

        call(get("/api/admin/public-requests/count"), ADMIN, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.count").value(2));
        mvc.perform(get("/api/admin/public-requests/count")).andExpect(status().isUnauthorized());
        call(get("/api/admin/public-requests/count"), KARI, null).andExpect(status().isForbidden());
    }

    @Test
    void onlySystemAdminsCanReadAndHandleRequests() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));

        mvc.perform(get("/api/admin/public-requests")).andExpect(status().isUnauthorized());
        call(get("/api/admin/public-requests"), KARI, null).andExpect(status().isForbidden());
        call(post("/api/admin/public-requests/" + id + "/reject"), KARI, null).andExpect(status().isForbidden());
        call(post("/api/admin/public-requests/" + id + "/booking"), KARI,
                bookingJson(ROOM_A, ORG_A, "Konsert", at(7, 18), at(7, 20)))
                .andExpect(status().isForbidden());
        assertThat(requestStatus(id)).isEqualTo("NEW");

        call(get("/api/admin/public-requests"), ADMIN, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(id.toString()))
                .andExpect(jsonPath("$[0].description").value("Konsert i hagen"))
                .andExpect(jsonPath("$[0].organizationName").value("Ekstern forening"))
                .andExpect(jsonPath("$[0].eventName").value("Hagekonsert"))
                .andExpect(jsonPath("$[0].preferredArea").value("TORGALLMENNINGEN"))
                .andExpect(jsonPath("$[0].status").value("NEW"));
    }

    @Test
    void rejectingMarksTheRequestOnce() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));

        call(post("/api/admin/public-requests/" + id + "/reject"), ADMIN, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"));
        call(post("/api/admin/public-requests/" + id + "/reject"), ADMIN, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_A, ORG_B, "Konsert", at(7, 18), at(7, 20)))
                .andExpect(status().isConflict());
    }

    @Test
    void adminBooksOvernightForAnOrganizationTheyAreNotMemberOfAndTheRequestIsLinked() throws Exception {
        UUID id = submit(at(7, 20), at(8, 2));

        // The admin has no memberships; the booking follows Organisasjon B's DIRECT access to room A.
        String body = call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                        bookingJson(ROOM_A, ORG_B, "Konsert", at(7, 20), at(8, 2)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.organizationId").value(ORG_B.toString()))
                .andReturn().getResponse().getContentAsString();
        String bookingId = com.jayway.jsonpath.JsonPath.read(body, "$.id");

        assertThat(requestStatus(id)).isEqualTo("TRANSFERRED");
        assertThat(jdbc.queryForObject("SELECT booking_id FROM public_requests WHERE id = ?", UUID.class, id))
                .isEqualTo(UUID.fromString(bookingId));

        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_A, ORG_B, "Konsert", at(9, 20), at(9, 22)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
    }

    @Test
    void adminCanTransferToAnOrganizationWithoutAccessWhileUsersStillCannotBookIt() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));

        // Organisasjon C has no access to room A: Ingrid (member of C) can't book it herself.
        call(post("/api/bookings"), "20000000-0000-0000-0000-000000000003",
                bookingJson(ROOM_A, ORG_C, "Selv", at(7, 18), at(7, 20)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NO_PERMISSION"));

        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_A, ORG_C, "Konsert", at(7, 18), at(7, 20)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.organizationId").value(ORG_C.toString()));
        assertThat(requestStatus(id)).isEqualTo("TRANSFERRED");

        // No access was granted, and the booking still blocks the slot.
        assertThat(jdbc.queryForObject("SELECT permission FROM room_access WHERE room_id = ? AND organization_id = ?",
                String.class, ROOM_A, ORG_C)).isEqualTo("NONE");
        call(post("/api/bookings"), KARI, bookingJson(ROOM_A, ORG_A, "Kolliderer", at(7, 19), at(7, 21)))
                .andExpect(status().isConflict());
        // An organization admin is no exception either: Jonas is ORG_ADMIN of A and member of C.
        call(post("/api/bookings"), JONAS, bookingJson(ROOM_A, ORG_C, "Selv", at(9, 18), at(9, 20)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NO_PERMISSION"));
    }

    @Test
    void aTransferIsApprovedEvenWhereTheOrganizationMustApplyWhileItsOwnBookingsStillNeedApproval() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));

        // Organisasjon A has REQUEST access to room B: Kari's own booking is a pending request.
        call(post("/api/bookings"), KARI, bookingJson(ROOM_B, ORG_A, "Selv", at(9, 18), at(9, 20)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"));

        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_B, ORG_A, "Konsert", at(7, 18), at(7, 20)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.requiresApproval").value(false));
        assertThat(requestStatus(id)).isEqualTo("TRANSFERRED");
        assertThat(jdbc.queryForObject("SELECT permission FROM room_access WHERE room_id = ? AND organization_id = ?",
                String.class, ROOM_B, ORG_A)).isEqualTo("REQUEST");
    }

    @Test
    void aRefusedBookingLeavesTheRequestNew() throws Exception {
        UUID id = submit(at(7, 18), at(7, 20));
        createBooking(KARI, ROOM_A, ORG_A, at(7, 18), at(7, 20));

        // Double booking.
        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_A, ORG_B, "Konsert", at(7, 18), at(7, 20)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT"));
        // A closed room can't be booked, not even on behalf.
        jdbc.update("UPDATE rooms SET status = 'DISABLED' WHERE id = ?", ROOM_B);
        call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                bookingJson(ROOM_B, ORG_A, "Konsert", at(7, 20), at(7, 22)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NO_PERMISSION"));

        assertThat(requestStatus(id)).isEqualTo("NEW");
        assertThat(jdbc.queryForObject("SELECT booking_id FROM public_requests WHERE id = ?", UUID.class, id)).isNull();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM bookings", Integer.class)).isEqualTo(1);
    }
}
