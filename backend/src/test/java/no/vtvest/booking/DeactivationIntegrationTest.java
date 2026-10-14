package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;

/** What happens to future bookings when rooms, organizations, users or memberships go away. */
class DeactivationIntegrationTest extends IntegrationTest {

    private static final UUID ORG_C = UUID.fromString("10000000-0000-0000-0000-00000000000c");

    private ResultActions updateRoomA(String status, Boolean cancelFutureBookings) throws Exception {
        return call(put("/api/admin/rooms/" + ROOM_A), ADMIN, """
                {"name":"Møterom A","color":"#2563eb","defaultPermission":"NONE","status":"%s","cancelFutureBookings":%s}
                """.formatted(status, cancelFutureBookings));
    }

    private String reasonOf(UUID id) {
        return jdbc.queryForObject("SELECT cancellation_reason FROM bookings WHERE id = ?", String.class, id);
    }

    private UUID cancellerOf(UUID id) {
        return jdbc.queryForObject("SELECT cancelled_by_id FROM bookings WHERE id = ?", UUID.class, id);
    }

    // ── Rooms ───────────────────────────────────────────────────────

    @Test
    void disablingOrArchivingARoomCancelsItsFutureBookingsOnlyWhenAsked() throws Exception {
        UUID future = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        UUID started = insertBooking(ROOM_A, ORG_A, KARI_ID, Instant.now().minus(10, ChronoUnit.MINUTES), "APPROVED");
        UUID elsewhere = createBooking(KARI, ROOM_B, ORG_A, at(7, 8), at(7, 9));

        mvc.perform(get("/api/admin/rooms/" + ROOM_A + "/future-bookings").with(user(ADMIN)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(future.toString()));

        updateRoomA("DISABLED", null).andExpect(status().isOk());
        updateRoomA("ARCHIVED", false).andExpect(status().isOk());
        assertThat(bookingStatus(future)).isEqualTo("APPROVED");
        // The booking still shows its room's name, though the archived room is gone from /api/rooms.
        mvc.perform(get("/api/bookings/" + future).with(user(OLA))).andExpect(jsonPath("$.roomName").value("Møterom A"));

        updateRoomA("DISABLED", true).andExpect(status().isOk());
        assertThat(bookingStatus(future)).isEqualTo("CANCELLED");
        assertThat(reasonOf(future)).isEqualTo("Rommet er stengt.");
        assertThat(cancellerOf(future)).isEqualTo(ADMIN_ID);
        assertThat(bookingVersion(future)).isEqualTo(1);
        assertThat(bookingStatus(started)).isEqualTo("APPROVED");
        assertThat(bookingStatus(elsewhere)).isEqualTo("PENDING");
    }

    @Test
    void archivingARoomWithCancellationUsesTheArchiveReason() throws Exception {
        UUID future = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        updateRoomA("ARCHIVED", true).andExpect(status().isOk());
        assertThat(bookingStatus(future)).isEqualTo("CANCELLED");
        assertThat(reasonOf(future)).isEqualTo("Rommet er arkivert.");
    }

    // ── Organizations ───────────────────────────────────────────────

    @Test
    void archivingAnOrganizationCancelsItsFutureBookingsOnlyWhenAsked() throws Exception {
        UUID approved = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        UUID pending = createBooking(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 13));
        UUID olas = createBooking(OLA, ROOM_A, ORG_B, at(7, 10), at(7, 11));

        mvc.perform(get("/api/admin/organizations/" + ORG_A + "/future-bookings").with(user(ADMIN)))
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].id").value(approved.toString()));

        call(patch("/api/admin/organizations/" + ORG_A), ADMIN, "{\"status\":\"ARCHIVED\"}").andExpect(status().isOk());
        assertThat(bookingStatus(approved)).isEqualTo("APPROVED");
        call(patch("/api/admin/organizations/" + ORG_A), ADMIN, "{\"status\":\"ACTIVE\"}").andExpect(status().isOk());

        call(patch("/api/admin/organizations/" + ORG_A), ADMIN, "{\"status\":\"ARCHIVED\",\"cancelFutureBookings\":true}")
                .andExpect(status().isOk());
        assertThat(bookingStatus(approved)).isEqualTo("CANCELLED");
        assertThat(bookingStatus(pending)).isEqualTo("CANCELLED");
        assertThat(reasonOf(approved)).isEqualTo("Organisasjonen er arkivert.");
        assertThat(bookingStatus(olas)).isEqualTo("APPROVED");

        // Restoring the organization does not restore its bookings.
        call(patch("/api/admin/organizations/" + ORG_A), ADMIN, "{\"status\":\"ACTIVE\"}").andExpect(status().isOk());
        assertThat(bookingStatus(approved)).isEqualTo("CANCELLED");
    }

    // ── Users ───────────────────────────────────────────────────────

    @Test
    void disablingAUserCancelsTheirRequestsAndOptionallyTheirBookings() throws Exception {
        UUID approved = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));
        UUID pending = createBooking(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 13));
        UUID jonas = createBooking(JONAS, ROOM_A, ORG_A, at(7, 10), at(7, 11));

        mvc.perform(get("/api/admin/users/" + KARI + "/future-bookings").with(user(ADMIN)))
                .andExpect(jsonPath("$.length()").value(2));

        call(patch("/api/admin/users/" + KARI), ADMIN, "{\"status\":\"DISABLED\"}").andExpect(status().isOk());
        assertThat(bookingStatus(pending)).isEqualTo("CANCELLED");
        assertThat(reasonOf(pending)).isEqualTo("Brukeren er deaktivert.");
        assertThat(bookingStatus(approved)).isEqualTo("APPROVED");

        call(patch("/api/admin/users/" + KARI), ADMIN, "{\"status\":\"DISABLED\",\"cancelFutureBookings\":true}")
                .andExpect(status().isOk());
        assertThat(bookingStatus(approved)).isEqualTo("CANCELLED");
        assertThat(bookingStatus(jonas)).isEqualTo("APPROVED");
    }

    @Test
    void approvalIsRefusedWhenTheRequesterIsDisabled() throws Exception {
        UUID pending = createBooking(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 13));
        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?", KARI_ID);
        call(post("/api/bookings/" + pending + "/approve"), ADMIN, "{\"version\":0}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
        assertThat(bookingStatus(pending)).isEqualTo("PENDING");
    }

    // ── Memberships ─────────────────────────────────────────────────

    @Test
    void removingAMembershipCancelsThatOrganizationsPendingRequestsOnly() throws Exception {
        // Jonas is ORG_ADMIN of A and a member of C.
        UUID requestForA = createBooking(JONAS, STORSALEN, ORG_A, at(7, 12), at(7, 13));
        UUID requestForC = createBooking(JONAS, STORSALEN, ORG_C, at(8, 12), at(8, 13));
        UUID approvedForC = createBooking(JONAS, ROOM_B, ORG_C, at(8, 8), at(8, 9));

        call(delete("/api/admin/users/" + JONAS + "/memberships/" + ORG_C), ADMIN, null).andExpect(status().isOk());
        assertThat(bookingStatus(requestForC)).isEqualTo("CANCELLED");
        assertThat(reasonOf(requestForC)).isEqualTo("Brukeren er ikke lenger medlem av organisasjonen.");
        assertThat(bookingStatus(approvedForC)).isEqualTo("APPROVED");
        assertThat(bookingStatus(requestForA)).isEqualTo("PENDING");
    }

    @Test
    void orgAdminRemovingAMemberCancelsTheirPendingRequests() throws Exception {
        UUID pending = createBooking(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 13));
        UUID approved = createBooking(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9));

        call(delete("/api/organizations/" + ORG_A + "/members/" + KARI), JONAS, null).andExpect(status().isNoContent());
        assertThat(bookingStatus(pending)).isEqualTo("CANCELLED");
        assertThat(cancellerOf(pending)).isEqualTo(JONAS_ID);
        assertThat(bookingStatus(approved)).isEqualTo("APPROVED");
    }

    // ── Impact preview ──────────────────────────────────────────────

    @Test
    void onlySystemAdminsSeeTheImpactPreview() throws Exception {
        for (String actor : new String[] {KARI, JONAS}) {
            mvc.perform(get("/api/admin/rooms/" + ROOM_A + "/future-bookings").with(user(actor))).andExpect(status().isForbidden());
            mvc.perform(get("/api/admin/organizations/" + ORG_A + "/future-bookings").with(user(actor)))
                    .andExpect(status().isForbidden());
            mvc.perform(get("/api/admin/users/" + KARI + "/future-bookings").with(user(actor))).andExpect(status().isForbidden());
        }
        mvc.perform(get("/api/admin/rooms/" + UUID.randomUUID() + "/future-bookings").with(user(ADMIN)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/admin/users/" + UUID.randomUUID() + "/future-bookings").with(user(ADMIN)))
                .andExpect(status().isNotFound());
    }
}
