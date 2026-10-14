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

/** Approve, reject and cancel: authorization, re-validation, conflicts and status transitions. */
class BookingWorkflowIntegrationTest extends IntegrationTest {

    private ResultActions postAs(String email, String path, String json) throws Exception {
        return mvc.perform(post(path)
                .with(user(email))
                .with(withCsrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json));
    }

    private UUID book(String email, UUID roomId, UUID orgId, Instant start, Instant end) throws Exception {
        String body = postAs(email, "/api/bookings", bookingJson(roomId, orgId, "Test", start, end))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(body.replaceAll(".*\"id\":\"([^\"]+)\".*", "$1"));
    }

    private ResultActions approve(String email, UUID id) throws Exception {
        return postAs(email, "/api/bookings/" + id + "/approve", "{\"version\":%d}".formatted(version(id)));
    }

    private ResultActions reject(String email, UUID id, String reason) throws Exception {
        return postAs(email, "/api/bookings/" + id + "/reject",
                "{\"version\":%d,\"reason\":\"%s\"}".formatted(version(id), reason));
    }

    private ResultActions cancel(String email, UUID id) throws Exception {
        return postAs(email, "/api/bookings/" + id + "/cancel", "{\"version\":%d}".formatted(version(id)));
    }

    private int version(UUID id) {
        return jdbc.queryForObject("SELECT version FROM bookings WHERE id = ?", Integer.class, id);
    }

    private String statusOf(UUID id) {
        return jdbc.queryForObject("SELECT status FROM bookings WHERE id = ?", String.class, id);
    }

    // ── Approve ─────────────────────────────────────────────────────

    @Test
    void adminApprovesRequestAndDecisionIsRecorded() throws Exception {
        UUID id = book(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14));

        postAs(ADMIN, "/api/bookings/" + id + "/approve", "{\"version\":0,\"comment\":\"Velkommen\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.decisionComment").value("Velkommen"))
                .andExpect(jsonPath("$.version").value(1));

        assertThat(jdbc.queryForObject("SELECT decided_by_id FROM bookings WHERE id = ?", UUID.class, id))
                .isEqualTo(ADMIN_ID);
        assertThat(jdbc.queryForObject("SELECT decided_at IS NOT NULL FROM bookings WHERE id = ?", Boolean.class, id))
                .isTrue();
    }

    @Test
    void onlyAdminsCanApproveOrReject() throws Exception {
        UUID id = book(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14));

        for (String email : new String[] {KARI, JONAS, OLA}) {
            approve(email, id).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
            reject(email, id, "Nei").andExpect(status().isForbidden());
        }
        assertThat(statusOf(id)).isEqualTo("PENDING");
    }

    @Test
    void approvalIsRefusedWhenAnotherRequestWasApprovedFirst() throws Exception {
        UUID first = book(KARI, STORSALEN, ORG_A, at(7, 18), at(7, 20));
        UUID second = book(OLA, STORSALEN, ORG_B, at(7, 19), at(7, 21));

        approve(ADMIN, first).andExpect(status().isOk());
        approve(ADMIN, second).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("CONFLICT"));
        assertThat(statusOf(second)).isEqualTo("PENDING");
    }

    @Test
    void approvalRechecksMembership() throws Exception {
        UUID id = book(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14));
        jdbc.update("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?", KARI_ID, ORG_A);
        try {
            approve(ADMIN, id).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("NOT_MEMBER"));
            assertThat(statusOf(id)).isEqualTo("PENDING");
        } finally {
            jdbc.update("INSERT INTO memberships (user_id, organization_id) VALUES (?, ?)", KARI_ID, ORG_A);
        }
    }

    @Test
    void approvalRechecksRoomPermission() throws Exception {
        UUID id = book(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14));
        jdbc.update("UPDATE room_access SET permission = 'NONE' WHERE room_id = ? AND organization_id = ?", STORSALEN, ORG_A);
        try {
            approve(ADMIN, id).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("NO_PERMISSION"));
        } finally {
            jdbc.update("UPDATE room_access SET permission = 'REQUEST' WHERE room_id = ? AND organization_id = ?", STORSALEN, ORG_A);
        }
    }

    @Test
    void approvalOfAStartedRequestIsRefused() throws Exception {
        UUID id = insertBooking(ROOM_A, ORG_A, KARI_ID, Instant.now().minus(1, ChronoUnit.HOURS), "PENDING");
        approve(ADMIN, id).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("INVALID_STATE"));
    }

    @Test
    void staleVersionIsRejected() throws Exception {
        UUID id = book(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14));
        postAs(ADMIN, "/api/bookings/" + id + "/approve", "{\"version\":7}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));
        postAs(ADMIN, "/api/bookings/" + id + "/approve", "{}").andExpect(status().isBadRequest());
    }

    // ── Reject ──────────────────────────────────────────────────────

    @Test
    void adminRejectsWithReason() throws Exception {
        UUID id = book(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14));

        reject(ADMIN, id, " ").andExpect(status().isBadRequest());
        reject(ADMIN, id, "Salen er opptatt")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.decisionComment").value("Salen er opptatt"));
        assertThat(jdbc.queryForObject("SELECT decided_by_id FROM bookings WHERE id = ?", UUID.class, id))
                .isEqualTo(ADMIN_ID);
    }

    // ── Invalid transitions ─────────────────────────────────────────

    @Test
    void finishedBookingsCannotChangeStatus() throws Exception {
        UUID approved = book(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        approve(ADMIN, approved).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("INVALID_STATE"));
        reject(ADMIN, approved, "Nei").andExpect(status().isConflict());

        UUID rejected = book(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 13));
        reject(ADMIN, rejected, "Nei").andExpect(status().isOk());
        approve(ADMIN, rejected).andExpect(status().isConflict());
        cancel(KARI, rejected).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("INVALID_STATE"));

        cancel(KARI, approved).andExpect(status().isOk());
        cancel(KARI, approved).andExpect(status().isConflict());
        approve(ADMIN, approved).andExpect(status().isConflict());
    }

    // ── Cancel ──────────────────────────────────────────────────────

    @Test
    void requesterCancelsOwnBookingAndTheSlotIsFreed() throws Exception {
        UUID id = book(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));

        cancel(KARI, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.cancelledAt").exists());
        assertThat(jdbc.queryForObject("SELECT cancelled_by_id FROM bookings WHERE id = ?", UUID.class, id))
                .isEqualTo(KARI_ID);

        book(OLA, ROOM_A, ORG_B, at(7, 8), at(7, 9));
    }

    @Test
    void requesterCanWithdrawPendingRequest() throws Exception {
        UUID id = book(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 13));
        cancel(KARI, id).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CANCELLED"));
    }

    @Test
    void otherOrganizationsCannotCancel() throws Exception {
        UUID approved = book(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        UUID pending = book(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 13));

        cancel(OLA, approved).andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
        // Another organization's pending request is invisible, so it is reported as not found.
        cancel(OLA, pending).andExpect(status().isNotFound());
        assertThat(statusOf(approved)).isEqualTo("APPROVED");
    }

    @Test
    void plainMembersCannotCancelOtherMembersBookings() throws Exception {
        jdbc.update("UPDATE memberships SET role = 'MEMBER' WHERE user_id = ? AND organization_id = ?", JONAS_ID, ORG_A);
        try {
            UUID id = book(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
            cancel(JONAS, id).andExpect(status().isForbidden());
        } finally {
            jdbc.update("UPDATE memberships SET role = 'ORG_ADMIN' WHERE user_id = ? AND organization_id = ?", JONAS_ID, ORG_A);
        }
    }

    @Test
    void organizationAdminCancelsOwnOrganizationsBookingsOnly() throws Exception {
        UUID karis = book(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        UUID olas = book(OLA, ROOM_A, ORG_B, at(7, 10), at(7, 11));

        cancel(JONAS, karis).andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT cancelled_by_id FROM bookings WHERE id = ?", UUID.class, karis))
                .isEqualTo(JONAS_ID);
        cancel(JONAS, olas).andExpect(status().isForbidden());
    }

    @Test
    void formerMembersCannotCancel() throws Exception {
        UUID id = book(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        jdbc.update("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?", KARI_ID, ORG_A);
        try {
            cancel(KARI, id).andExpect(status().isForbidden());
            assertThat(statusOf(id)).isEqualTo("APPROVED");
        } finally {
            jdbc.update("INSERT INTO memberships (user_id, organization_id) VALUES (?, ?)", KARI_ID, ORG_A);
        }
    }

    @Test
    void adminCancelsAnyBookingButNotStartedOnes() throws Exception {
        UUID id = book(OLA, ROOM_A, ORG_B, at(7, 8), at(7, 9));
        cancel(ADMIN, id).andExpect(status().isOk());

        UUID started = insertBooking(ROOM_A, ORG_A, KARI_ID, Instant.now().minus(30, ChronoUnit.MINUTES), "APPROVED");
        cancel(ADMIN, started).andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("INVALID_STATE"));
        cancel(KARI, started).andExpect(status().isConflict());
    }

    @Test
    void cancellationReasonAndCancellerAreShownToTheOwnOrganizationOnly() throws Exception {
        UUID id = book(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        postAs(JONAS, "/api/bookings/" + id + "/cancel", "{\"version\":0,\"reason\":\"Styret trenger rommet\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cancellationReason").value("Styret trenger rommet"))
                .andExpect(jsonPath("$.cancelledById").value(JONAS))
                .andExpect(jsonPath("$.cancelledByName").isNotEmpty());

        mvc.perform(get("/api/bookings/mine").with(user(KARI)))
                .andExpect(jsonPath("$[0].status").value("CANCELLED"))
                .andExpect(jsonPath("$[0].cancellationReason").value("Styret trenger rommet"))
                .andExpect(jsonPath("$[0].cancelledById").value(JONAS));
        // Other organizations can't see a cancelled booking at all, so never the reason or who cancelled.
        mvc.perform(get("/api/bookings/" + id).with(user(OLA))).andExpect(status().isNotFound());
    }

    @Test
    void approvalCommentIsRecorded() throws Exception {
        UUID id = book(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14));
        postAs(ADMIN, "/api/bookings/" + id + "/approve", "{\"version\":0,\"comment\":\"Husk å rydde\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.decisionComment").value("Husk å rydde"));
    }

    // ── Expired requests ────────────────────────────────────────────

    @Test
    void expiredRequestsLeaveTheQueueAndCalendarButStayInMyBookings() throws Exception {
        UUID expired = insertBooking(STORSALEN, ORG_A, KARI_ID, Instant.now().minus(30, ChronoUnit.MINUTES), "PENDING");
        UUID upcoming = book(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14));
        UUID approved = insertBooking(ROOM_A, ORG_A, KARI_ID, Instant.now().minus(30, ChronoUnit.MINUTES), "APPROVED");

        mvc.perform(get("/api/bookings/requests").with(user(ADMIN)))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(upcoming.toString()));

        String from = Instant.now().minus(1, ChronoUnit.DAYS).toString();
        String to = Instant.now().plus(1, ChronoUnit.DAYS).toString();
        mvc.perform(get("/api/bookings").param("from", from).param("to", to).with(user(KARI)))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(approved.toString()));

        mvc.perform(get("/api/bookings/mine").with(user(KARI)))
                .andExpect(jsonPath("$[?(@.id == '%s')].status".formatted(expired)).value("PENDING"));
        // It can no longer be approved or withdrawn.
        approve(ADMIN, expired).andExpect(status().isConflict());
        cancel(KARI, expired).andExpect(status().isConflict());
    }

    @Test
    void unknownBookingIsNotFound() throws Exception {
        postAs(ADMIN, "/api/bookings/" + UUID.randomUUID() + "/approve", "{\"version\":0}")
                .andExpect(status().isNotFound());
    }
}
