package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;

/** PUT /api/bookings/{id}: who may edit, which status a moved booking gets, and the time rules. */
class BookingEditIntegrationTest extends IntegrationTest {

    private ResultActions edit(String actor, UUID id, UUID roomId, String title, Instant start, Instant end) throws Exception {
        return edit(actor, id, bookingVersion(id), roomId, title, start, end);
    }

    private ResultActions edit(String actor, UUID id, int version, UUID roomId, String title, Instant start, Instant end)
            throws Exception {
        return call(put("/api/bookings/" + id), actor, """
                {"version":%d,"roomId":"%s","title":"%s","description":"Ny beskrivelse","start":"%s","end":"%s"}
                """.formatted(version, roomId, title, start, end));
    }

    private UUID approvedRequest(String actor, UUID orgId, Instant start, Instant end) throws Exception {
        UUID id = createBooking(actor, STORSALEN, orgId, start, end);
        call(post("/api/bookings/" + id + "/approve"), ADMIN, "{\"version\":0,\"comment\":\"OK\"}").andExpect(status().isOk());
        return id;
    }

    // ── Text only ───────────────────────────────────────────────────

    @Test
    void newTitleKeepsTheStatusAndRecordsWhoEdited() throws Exception {
        UUID id = approvedRequest(KARI, ORG_A, at(7, 12), at(7, 14));

        edit(KARI, id, STORSALEN, "Nytt navn", at(7, 12), at(7, 14))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Nytt navn"))
                .andExpect(jsonPath("$.description").value("Ny beskrivelse"))
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.decisionComment").value("OK"))
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.updatedAt").isString())
                .andExpect(jsonPath("$.updatedByName").value("Kari Nordmann"));

        // Other organizations see that it was edited, but not by whom.
        mvc.perform(get("/api/bookings/" + id).with(user(OLA)))
                .andExpect(jsonPath("$.updatedAt").isString())
                .andExpect(jsonPath("$.updatedByName").value(nullValue()))
                .andExpect(jsonPath("$.roomName").value("Storsalen"));
    }

    // ── Moves ───────────────────────────────────────────────────────

    @Test
    void directRoomMoveStaysApprovedAndIsCheckedForConflicts() throws Exception {
        UUID id = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        createBooking(OLA, ROOM_A, ORG_B, at(7, 10), at(7, 11));

        edit(KARI, id, ROOM_A, "Flyttet", at(7, 10), at(7, 11))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT"));
        // Overlapping its own old slot is fine.
        edit(KARI, id, ROOM_A, "Flyttet", at(7, 8).plus(30, ChronoUnit.MINUTES), at(7, 10))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.requiresApproval").value(false));
    }

    @Test
    void requesterMovingAnApprovedRequestMakesItPendingAndClearsTheDecision() throws Exception {
        UUID id = approvedRequest(KARI, ORG_A, at(7, 12), at(7, 14));

        edit(KARI, id, STORSALEN, "Seminar", at(7, 15), at(7, 17))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.requiresApproval").value(true))
                .andExpect(jsonPath("$.decidedAt").value(nullValue()))
                .andExpect(jsonPath("$.decisionComment").value(nullValue()));
        assertThat(jdbc.queryForObject("SELECT decided_by_id FROM bookings WHERE id = ?", UUID.class, id)).isNull();

        // The slot is released until the request is approved again.
        createBooking(OLA, ROOM_A, ORG_B, at(7, 15), at(7, 16));
        mvc.perform(get("/api/bookings/requests").with(user(ADMIN)))
                .andExpect(jsonPath("$[?(@.id == '%s')].status".formatted(id)).value("PENDING"));
    }

    @Test
    void systemAdminMovingAnApprovedRequestKeepsItApproved() throws Exception {
        UUID id = approvedRequest(KARI, ORG_A, at(7, 12), at(7, 14));
        edit(ADMIN, id, STORSALEN, "Seminar", at(7, 15), at(7, 17))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.updatedByName").value("Silje Aas"));
    }

    @Test
    void movingToAnotherRoomUsesThatRoomsPermission() throws Exception {
        UUID id = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));

        edit(KARI, id, ROOM_B, "Til B", at(7, 8), at(7, 9))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.roomId").value(ROOM_B.toString()))
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.requiresApproval").value(true));
        edit(KARI, id, ROOM_A, "Tilbake", at(7, 8), at(7, 9))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.requiresApproval").value(false));

        // Organization B has no access to room B.
        UUID olas = createBooking(OLA, ROOM_A, ORG_B, at(8, 8), at(8, 9));
        edit(OLA, olas, ROOM_B, "Til B", at(8, 8), at(8, 9))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NO_PERMISSION"));
        assertThat(jdbc.queryForObject("SELECT room_id FROM bookings WHERE id = ?", UUID.class, olas)).isEqualTo(ROOM_A);
    }

    @Test
    void theOrganizationCannotBeChanged() throws Exception {
        UUID id = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        call(put("/api/bookings/" + id), KARI, """
                {"version":0,"roomId":"%s","organizationId":"%s","title":"X","start":"%s","end":"%s"}
                """.formatted(ROOM_A, ORG_B, at(7, 8), at(7, 9)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.organizationId").value(ORG_A.toString()));
    }

    // ── Archived rooms ──────────────────────────────────────────────

    @Test
    void bookingsInAnArchivedRoomCanOnlyGetANewTitle() throws Exception {
        UUID id = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        UUID other = createBooking(KARI, ROOM_B, ORG_A, at(7, 8), at(7, 9));
        jdbc.update("UPDATE rooms SET status = 'ARCHIVED' WHERE id = ?", ROOM_A);

        edit(KARI, id, ROOM_A, "Ny tittel", at(7, 8), at(7, 9)).andExpect(status().isOk());
        edit(KARI, id, ROOM_A, "Ny tid", at(7, 10), at(7, 11))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
        edit(KARI, id, ROOM_B, "Annet rom", at(7, 10), at(7, 11)).andExpect(status().isConflict());
        // Nothing can be moved into an archived room.
        edit(KARI, other, ROOM_A, "Inn", at(7, 12), at(7, 13)).andExpect(status().isNotFound());
    }

    // ── Who may edit ────────────────────────────────────────────────

    @Test
    void onlyTheRequesterTheOrgAdminAndSystemAdminsMayEdit() throws Exception {
        UUID approved = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        UUID pending = createBooking(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 13));

        edit(OLA, approved, ROOM_A, "Kapret", at(7, 8), at(7, 9))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        // Another organization's request is invisible.
        edit(OLA, pending, STORSALEN, "Kapret", at(7, 12), at(7, 13)).andExpect(status().isNotFound());

        edit(JONAS, approved, ROOM_A, "Fra org-admin", at(7, 8), at(7, 9)).andExpect(status().isOk());
        edit(ADMIN, approved, ROOM_A, "Fra admin", at(7, 8), at(7, 9)).andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT title FROM bookings WHERE id = ?", String.class, approved)).isEqualTo("Fra admin");
    }

    @Test
    void plainMembersFormerMembersAndAdminsOfArchivedOrganizationsMayNotEdit() throws Exception {
        UUID id = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));

        jdbc.update("UPDATE memberships SET role = 'MEMBER' WHERE user_id = ? AND organization_id = ?", JONAS_ID, ORG_A);
        edit(JONAS, id, ROOM_A, "X", at(7, 8), at(7, 9)).andExpect(status().isForbidden());
        jdbc.update("UPDATE memberships SET role = 'ORG_ADMIN' WHERE user_id = ? AND organization_id = ?", JONAS_ID, ORG_A);

        jdbc.update("UPDATE organizations SET status = 'ARCHIVED' WHERE id = ?", ORG_A);
        edit(JONAS, id, ROOM_A, "X", at(7, 8), at(7, 9)).andExpect(status().isForbidden());
        call(post("/api/bookings/" + id + "/cancel"), JONAS, "{\"version\":0}").andExpect(status().isForbidden());
        // The requester may still rename their own booking.
        edit(KARI, id, ROOM_A, "Fortsatt min", at(7, 8), at(7, 9)).andExpect(status().isOk());
        jdbc.update("UPDATE organizations SET status = 'ACTIVE' WHERE id = ?", ORG_A);

        jdbc.update("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?", KARI_ID, ORG_A);
        edit(KARI, id, ROOM_A, "X", at(7, 8), at(7, 9)).andExpect(status().isForbidden());
    }

    // ── States and rules ────────────────────────────────────────────

    @Test
    void finishedStartedAndStaleBookingsCannotBeEdited() throws Exception {
        UUID cancelled = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        call(post("/api/bookings/" + cancelled + "/cancel"), KARI, "{\"version\":0}").andExpect(status().isOk());
        edit(KARI, cancelled, ROOM_A, "X", at(7, 8), at(7, 9))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));

        UUID started = insertBooking(ROOM_A, ORG_A, KARI_ID, Instant.now().minus(10, ChronoUnit.MINUTES), "APPROVED");
        edit(KARI, started, ROOM_A, "X", at(7, 10), at(7, 11)).andExpect(jsonPath("$.code").value("INVALID_STATE"));
        UUID expired = insertBooking(STORSALEN, ORG_A, KARI_ID, Instant.now().minus(10, ChronoUnit.MINUTES), "PENDING");
        edit(KARI, expired, STORSALEN, "X", at(7, 10), at(7, 11)).andExpect(jsonPath("$.code").value("INVALID_STATE"));

        UUID id = createBooking(KARI, ROOM_A, ORG_A, at(7, 12), at(7, 13));
        edit(KARI, id, 5, ROOM_A, "X", at(7, 12), at(7, 13))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));
    }

    @Test
    void newValuesFollowTheCreateRules() throws Exception {
        UUID id = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));

        edit(KARI, id, ROOM_A, "X", at(7, 9), at(7, 8)).andExpect(jsonPath("$.code").value("VALIDATION"));
        edit(KARI, id, ROOM_A, "X", at(-1, 8), at(-1, 9)).andExpect(jsonPath("$.code").value("VALIDATION"));
        edit(KARI, id, ROOM_A, "X", at(7, 0), at(7, 23)).andExpect(jsonPath("$.code").value("RULE_VIOLATION"));
        edit(KARI, id, ROOM_A, "X", at(200, 8), at(200, 9)).andExpect(jsonPath("$.code").value("RULE_VIOLATION"));
        edit(KARI, id, ROOM_A, " ", at(7, 8), at(7, 9)).andExpect(status().isBadRequest());
        edit(KARI, id, ROOM_A, "x".repeat(81), at(7, 8), at(7, 9)).andExpect(status().isBadRequest());
        edit(KARI, id, UUID.randomUUID(), "X", at(7, 8), at(7, 9)).andExpect(status().isNotFound());
        call(put("/api/bookings/" + id), KARI, "{\"roomId\":\"%s\",\"title\":\"X\",\"start\":\"%s\",\"end\":\"%s\"}"
                .formatted(ROOM_A, at(7, 8), at(7, 9))).andExpect(status().isBadRequest());

        assertThat(bookingVersion(id)).isZero();
    }

    // ── Bookings whose requester is gone ────────────────────────────

    @Test
    void aFormerMembersBookingCannotBeMovedIntoARequest() throws Exception {
        UUID id = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        jdbc.update("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?", KARI_ID, ORG_A);

        edit(JONAS, id, ROOM_B, "Til B", at(7, 8), at(7, 9))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("ikke lenger medlem")));
        assertThat(bookingStatus(id)).isEqualTo("APPROVED");
        assertThat(jdbc.queryForObject("SELECT room_id FROM bookings WHERE id = ?", UUID.class, id)).isEqualTo(ROOM_A);

        // Moves that stay approved are still fine.
        edit(JONAS, id, ROOM_A, "Senere", at(7, 10), at(7, 11))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));
    }

    @Test
    void aDisabledUsersBookingCannotBeMovedIntoARequest() throws Exception {
        UUID id = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?", KARI_ID);

        edit(JONAS, id, ROOM_B, "Til B", at(7, 8), at(7, 9))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("deaktivert")));
        assertThat(bookingStatus(id)).isEqualTo("APPROVED");
        // A system admin moving it keeps it approved, so that is allowed.
        edit(ADMIN, id, ROOM_B, "Til B", at(7, 8), at(7, 9))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));
    }

    @Test
    void anAdminMovingADirectBookingIntoARequestRoomRecordsNoDecision() throws Exception {
        UUID id = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));

        edit(ADMIN, id, ROOM_B, "Til B", at(7, 8), at(7, 9))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.requiresApproval").value(true))
                .andExpect(jsonPath("$.decidedAt").value(nullValue()))
                .andExpect(jsonPath("$.decidedByName").value(nullValue()));
        assertThat(jdbc.queryForObject("SELECT decided_by_id FROM bookings WHERE id = ?", UUID.class, id)).isNull();
        // So it is not listed as a decision in the admin's history.
        mvc.perform(get("/api/bookings/requests").with(user(ADMIN)))
                .andExpect(jsonPath("$[?(@.id == '%s')]".formatted(id)).isEmpty());
    }
}
