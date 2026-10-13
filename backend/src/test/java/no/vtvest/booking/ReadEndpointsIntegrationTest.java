package no.vtvest.booking;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/** The read endpoints the SPA uses besides the calendar: my bookings, the admin queue and directories. */
class ReadEndpointsIntegrationTest extends IntegrationTest {

    private UUID book(String email, UUID roomId, UUID orgId, String title, int days) throws Exception {
        String body = mvc.perform(post("/api/bookings")
                        .with(user(email))
                        .with(withCsrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(bookingJson(roomId, orgId, title, at(days, 12), at(days, 13))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(body.replaceAll(".*\"id\":\"([^\"]+)\".*", "$1"));
    }

    @Test
    void myBookingsListsOnlyMyOwnInEveryStatus() throws Exception {
        UUID request = book(KARI, STORSALEN, ORG_A, "Min søknad", 7);
        book(KARI, ROOM_A, ORG_A, "Min booking", 8);
        book(JONAS, ROOM_A, ORG_A, "Jonas sin", 9);
        mvc.perform(post("/api/bookings/" + request + "/reject")
                        .with(user(ADMIN))
                        .with(withCsrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":0,\"reason\":\"Opptatt\"}"))
                .andExpect(status().isOk());

        mvc.perform(get("/api/bookings/mine").with(user(KARI)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].title").value("Min søknad"))
                .andExpect(jsonPath("$[0].status").value("REJECTED"))
                .andExpect(jsonPath("$[0].decisionComment").value("Opptatt"))
                .andExpect(jsonPath("$[0].decidedByName").value("Silje Aas"))
                .andExpect(jsonPath("$[0].requestedById").value(KARI_ID.toString()))
                .andExpect(jsonPath("$[1].title").value("Min booking"));
    }

    @Test
    void requesterIsOnlyShownToOwnOrganizationAndAdmins() throws Exception {
        UUID id = book(KARI, ROOM_A, ORG_A, "Bekreftet", 7);

        mvc.perform(get("/api/bookings/" + id).with(user(OLA)))
                .andExpect(jsonPath("$.requestedById").doesNotExist())
                .andExpect(jsonPath("$.requestedByName").doesNotExist());
        mvc.perform(get("/api/bookings/" + id).with(user(JONAS)))
                .andExpect(jsonPath("$.requestedByName").value("Kari Nordmann"));
        mvc.perform(get("/api/bookings/" + id).with(user(ADMIN)))
                .andExpect(jsonPath("$.requestedById").value(KARI_ID.toString()));
    }

    @Test
    void adminQueueHasPendingAndDecidedRequestsAndIsAdminOnly() throws Exception {
        book(KARI, STORSALEN, ORG_A, "Venter", 7);
        UUID decided = book(OLA, STORSALEN, ORG_B, "Behandlet", 8);
        book(KARI, ROOM_A, ORG_A, "Direkte", 9);
        mvc.perform(post("/api/bookings/" + decided + "/approve")
                        .with(user(ADMIN))
                        .with(withCsrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":0}"))
                .andExpect(status().isOk());

        mvc.perform(get("/api/bookings/requests").with(user(ADMIN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].status").value("PENDING"))
                .andExpect(jsonPath("$[0].requestedByName").value("Kari Nordmann"))
                .andExpect(jsonPath("$[1].status").value("APPROVED"));

        for (String email : new String[] {KARI, JONAS}) {
            mvc.perform(get("/api/bookings/requests").with(user(email)))
                    .andExpect(status().isForbidden());
        }
    }

    @Test
    void organizationsAreListedForEveryUser() throws Exception {
        mvc.perform(get("/api/organizations").with(user(OLA)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].name").value("Organisasjon A"));
    }

    @Test
    void userDirectoryIsAdminOnly() throws Exception {
        mvc.perform(get("/api/admin/users").with(user(ADMIN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(5))
                .andExpect(jsonPath("$[?(@.displayName == 'Jonas Lie')].memberships.length()").value(2));
        mvc.perform(get("/api/admin/users").with(user(KARI))).andExpect(status().isForbidden());
    }

    @Test
    void adminsSeeEveryOrganizationsRoomPermission() throws Exception {
        mvc.perform(get("/api/rooms").with(user(ADMIN)))
                .andExpect(jsonPath("$[0].permissions.length()").value(3));
        mvc.perform(get("/api/rooms").with(user(KARI)))
                .andExpect(jsonPath("$[0].permissions.length()").value(1));
    }
}
