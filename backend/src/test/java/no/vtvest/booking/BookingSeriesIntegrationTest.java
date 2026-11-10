package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;

/** Weekly series: create, preview, read, cancel, approve, reject and edit "this and following". */
class BookingSeriesIntegrationTest extends IntegrationTest {

    private static final ZoneId OSLO = ZoneId.of("Europe/Oslo");

    private static String seriesJson(UUID roomId, UUID orgId, Instant start, Instant end, int weeks, boolean skip) {
        String until = start.atZone(OSLO).toLocalDate().plusWeeks(weeks - 1).toString();
        return """
                {"roomId":"%s","organizationId":"%s","title":"Øving","start":"%s","end":"%s",
                 "recurrence":{"intervalWeeks":1,"until":"%s"},"skipConflicts":%s}
                """.formatted(roomId, orgId, start, end, until, skip);
    }

    /** Creates a weekly series of {@code weeks} occurrences and returns its id. */
    private UUID series(String actor, UUID roomId, UUID orgId, Instant start, Instant end, int weeks) throws Exception {
        String body = call(post("/api/bookings/series"), actor, seriesJson(roomId, orgId, start, end, weeks, false))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(JsonPath.read(body, "$.seriesId"));
    }

    private List<UUID> occurrences(UUID seriesId) {
        return jdbc.queryForList("SELECT id FROM bookings WHERE series_id = ? ORDER BY start_at", UUID.class, seriesId);
    }

    private Instant startOf(UUID id) {
        return jdbc.queryForObject("SELECT start_at FROM bookings WHERE id = ?", java.sql.Timestamp.class, id).toInstant();
    }

    private Instant endOf(UUID id) {
        return jdbc.queryForObject("SELECT end_at FROM bookings WHERE id = ?", java.sql.Timestamp.class, id).toInstant();
    }

    private int bookingCount() {
        return jdbc.queryForObject("SELECT count(*) FROM bookings", Integer.class);
    }

    /** An approved booking straight into the database, e.g. one made after a series was requested. */
    private void insertApproved(UUID roomId, UUID orgId, UUID requesterId, Instant start, Instant end) {
        jdbc.update("""
                INSERT INTO bookings (room_id, organization_id, requested_by_id, title, start_at, end_at, status, requires_approval)
                VALUES (?, ?, ?, 'Blokkerer', ?::timestamptz, ?::timestamptz, 'APPROVED', false)
                """, roomId, orgId, requesterId, start.toString(), end.toString());
    }

    private ResultActions editFollowing(String actor, UUID seriesId, UUID fromId, UUID roomId, Instant start, Instant end,
            boolean skip, boolean dryRun) throws Exception {
        return call(put("/api/bookings/series/" + seriesId), actor, """
                {"fromBookingId":"%s","version":%d,"roomId":"%s","title":"Endret","start":"%s","end":"%s",
                 "skipConflicts":%s,"dryRun":%s}
                """.formatted(fromId, bookingVersion(fromId), roomId, start, end, skip, dryRun));
    }

    private static LocalDateTime local(Instant instant) {
        return instant.atZone(OSLO).toLocalDateTime();
    }

    // ── Create and preview ──────────────────────────────────────────

    @Test
    void previewMarksTakenTimesAndWritesNothing() throws Exception {
        // Wide enough to cover the second occurrence whether or not a DST change comes between.
        createBooking(OLA, ROOM_A, ORG_B, at(14, 6), at(14, 12));
        int before = bookingCount();

        call(post("/api/bookings/series/preview"), KARI, seriesJson(ROOM_A, ORG_A, at(7, 8), at(7, 9), 4, false))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.occurrences.length()").value(4))
                .andExpect(jsonPath("$.occurrences[0].conflict").value(false))
                .andExpect(jsonPath("$.occurrences[1].conflict").value(true))
                .andExpect(jsonPath("$.occurrences[2].conflict").value(false));
        assertThat(bookingCount()).isEqualTo(before);
    }

    @Test
    void conflictsFailTheWholeSeriesUnlessSkipped() throws Exception {
        createBooking(OLA, ROOM_A, ORG_B, at(14, 6), at(14, 12));
        int before = bookingCount();

        call(post("/api/bookings/series"), KARI, seriesJson(ROOM_A, ORG_A, at(7, 8), at(7, 9), 4, false))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT"))
                .andExpect(jsonPath("$.conflicts.length()").value(1))
                .andExpect(jsonPath("$.conflicts[0].start").isString());
        assertThat(bookingCount()).isEqualTo(before);

        String body = call(post("/api/bookings/series"), KARI, seriesJson(ROOM_A, ORG_A, at(7, 8), at(7, 9), 4, true))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.created.length()").value(3))
                .andExpect(jsonPath("$.skipped.length()").value(1))
                .andExpect(jsonPath("$.created[0].status").value("APPROVED"))
                .andReturn().getResponse().getContentAsString();
        UUID seriesId = UUID.fromString(JsonPath.read(body, "$.seriesId"));
        assertThat(occurrences(seriesId)).hasSize(3);
        mvc.perform(get("/api/bookings/" + occurrences(seriesId).getFirst()).with(user(OLA)))
                .andExpect(jsonPath("$.seriesId").value(seriesId.toString()));
    }

    @Test
    void aSeriesWhereEveryTimeIsTakenIsRefusedEvenWhenSkipping() throws Exception {
        createBooking(OLA, ROOM_A, ORG_B, at(7, 6), at(7, 12));
        createBooking(OLA, ROOM_A, ORG_B, at(14, 6), at(14, 12));
        call(post("/api/bookings/series"), KARI, seriesJson(ROOM_A, ORG_A, at(7, 8), at(7, 9), 2, true))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.conflicts.length()").value(2));
    }

    @Test
    void seriesFollowTheMembershipPermissionAndLimitRules() throws Exception {
        call(post("/api/bookings/series"), OLA, seriesJson(ROOM_A, ORG_A, at(7, 8), at(7, 9), 3, false))
                .andExpect(jsonPath("$.code").value("NOT_MEMBER"));
        call(post("/api/bookings/series"), OLA, seriesJson(ROOM_B, ORG_B, at(7, 8), at(7, 9), 3, false))
                .andExpect(jsonPath("$.code").value("NO_PERMISSION"));
        call(post("/api/bookings/series/preview"), OLA, seriesJson(ROOM_B, ORG_B, at(7, 8), at(7, 9), 3, false))
                .andExpect(jsonPath("$.code").value("NO_PERMISSION"));
        call(post("/api/bookings/series"), KARI, seriesJson(ROOM_A, ORG_A, at(7, 8), at(7, 9), 1, false))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION"));
        call(post("/api/bookings/series"), KARI, seriesJson(ROOM_A, ORG_A, at(150, 8), at(150, 9), 6, false))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("RULE_VIOLATION"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("180 dager")));
        call(post("/api/bookings/series"), KARI, seriesJson(ROOM_A, ORG_A, at(7, 8), at(7, 9), 3, false)
                .replace("\"intervalWeeks\":1", "\"intervalWeeks\":5"))
                .andExpect(status().isBadRequest());
        call(post("/api/bookings/series"), KARI, """
                {"roomId":"%s","organizationId":"%s","title":"X","start":"%s","end":"%s"}
                """.formatted(ROOM_A, ORG_A, at(7, 8), at(7, 9)))
                .andExpect(status().isBadRequest());
        assertThat(bookingCount()).isZero();
    }

    // ── Read ────────────────────────────────────────────────────────

    @Test
    void otherOrganizationsSeeOnlyTheApprovedOccurrences() throws Exception {
        UUID seriesId = series(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14), 3);

        mvc.perform(get("/api/bookings/series/" + seriesId).with(user(KARI)))
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].status").value("PENDING"));
        mvc.perform(get("/api/bookings/series/" + seriesId).with(user(OLA))).andExpect(status().isNotFound());
        mvc.perform(get("/api/bookings/series/" + UUID.randomUUID()).with(user(ADMIN))).andExpect(status().isNotFound());

        UUID first = occurrences(seriesId).getFirst();
        call(post("/api/bookings/" + first + "/approve"), ADMIN, "{\"version\":0}").andExpect(status().isOk());
        mvc.perform(get("/api/bookings/series/" + seriesId).with(user(OLA)))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(first.toString()));
    }

    // ── Approve and reject ──────────────────────────────────────────

    @Test
    void adminApprovesTheFreeOccurrencesAndReportsTheRest() throws Exception {
        UUID seriesId = series(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14), 3);
        List<UUID> ids = occurrences(seriesId);
        insertApproved(STORSALEN, ORG_B, OLA_ID, at(14, 9), at(14, 17));

        for (String actor : new String[] {KARI, JONAS, OLA}) {
            call(post("/api/bookings/series/" + seriesId + "/approve"), actor, "{}").andExpect(status().isForbidden());
        }
        call(post("/api/bookings/series/" + seriesId + "/approve"), ADMIN, "{\"comment\":\"Velkommen\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.approved.length()").value(2))
                .andExpect(jsonPath("$.approved[0].decisionComment").value("Velkommen"))
                .andExpect(jsonPath("$.notApproved.length()").value(1))
                .andExpect(jsonPath("$.notApproved[0].id").value(ids.get(1).toString()))
                .andExpect(jsonPath("$.notApproved[0].code").value("CONFLICT"));
        assertThat(ids).extracting(this::bookingStatus).containsExactly("APPROVED", "PENDING", "APPROVED");

        // Nothing left to approve without a conflict, but the remaining one can still be rejected on its own.
        call(post("/api/bookings/" + ids.get(1) + "/reject"), ADMIN,
                "{\"version\":%d,\"reason\":\"Opptatt\"}".formatted(bookingVersion(ids.get(1)))).andExpect(status().isOk());
        call(post("/api/bookings/series/" + seriesId + "/approve"), ADMIN, "{}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
    }

    @Test
    void seriesApprovalRechecksTheRequester() throws Exception {
        UUID seriesId = series(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14), 2);
        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?", KARI_ID);
        call(post("/api/bookings/series/" + seriesId + "/approve"), ADMIN, "{}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
        jdbc.update("UPDATE users SET status = 'ACTIVE' WHERE id = ?", KARI_ID);

        jdbc.update("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?", KARI_ID, ORG_A);
        call(post("/api/bookings/series/" + seriesId + "/approve"), ADMIN, "{}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_MEMBER"));
        assertThat(occurrences(seriesId)).extracting(this::bookingStatus).containsOnly("PENDING");
    }

    @Test
    void adminRejectsAllPendingOccurrences() throws Exception {
        UUID seriesId = series(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14), 3);
        UUID first = occurrences(seriesId).getFirst();
        call(post("/api/bookings/" + first + "/approve"), ADMIN, "{\"version\":0}").andExpect(status().isOk());

        call(post("/api/bookings/series/" + seriesId + "/reject"), ADMIN, "{\"reason\":\" \"}").andExpect(status().isBadRequest());
        call(post("/api/bookings/series/" + seriesId + "/reject"), KARI, "{\"reason\":\"Nei\"}").andExpect(status().isForbidden());
        call(post("/api/bookings/series/" + seriesId + "/reject"), ADMIN, "{\"reason\":\"Salen er opptatt\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].status").value("REJECTED"))
                .andExpect(jsonPath("$[0].decisionComment").value("Salen er opptatt"));
        assertThat(occurrences(seriesId)).extracting(this::bookingStatus).containsExactly("APPROVED", "REJECTED", "REJECTED");
    }

    // ── Cancel ──────────────────────────────────────────────────────

    @Test
    void cancelThisAndFollowingThenTheRest() throws Exception {
        UUID seriesId = series(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9), 4);
        List<UUID> ids = occurrences(seriesId);

        call(post("/api/bookings/series/" + seriesId + "/cancel"), KARI,
                "{\"fromBookingId\":\"%s\",\"reason\":\"Ferie\"}".formatted(ids.get(2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].cancellationReason").value("Ferie"));
        assertThat(ids).extracting(this::bookingStatus).containsExactly("APPROVED", "APPROVED", "CANCELLED", "CANCELLED");

        call(post("/api/bookings/series/" + seriesId + "/cancel"), KARI, "{}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));
        call(post("/api/bookings/series/" + seriesId + "/cancel"), KARI, "{}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
    }

    @Test
    void cancellingASeriesNeedsTheRightToCancelEveryOccurrence() throws Exception {
        UUID seriesId = series(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9), 3);
        UUID other = createBooking(KARI, ROOM_A, ORG_A, at(30, 8), at(30, 9));

        call(post("/api/bookings/series/" + seriesId + "/cancel"), OLA, "{}")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        call(post("/api/bookings/series/" + seriesId + "/cancel"), KARI, "{\"fromBookingId\":\"%s\"}".formatted(other))
                .andExpect(status().isNotFound());
        assertThat(occurrences(seriesId)).extracting(this::bookingStatus).containsOnly("APPROVED");

        call(post("/api/bookings/series/" + seriesId + "/cancel"), JONAS, "{}").andExpect(status().isOk());
    }

    @Test
    void singleOccurrencesCanBeEditedAndCancelledOnTheirOwn() throws Exception {
        UUID seriesId = series(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9), 3);
        List<UUID> ids = occurrences(seriesId);

        call(put("/api/bookings/" + ids.get(1)), KARI, """
                {"version":0,"roomId":"%s","title":"Bare denne","start":"%s","end":"%s"}
                """.formatted(ROOM_A, startOf(ids.get(1)), endOf(ids.get(1))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.seriesId").value(seriesId.toString()));
        call(post("/api/bookings/" + ids.get(0) + "/cancel"), KARI, "{\"version\":0}").andExpect(status().isOk());

        assertThat(ids).extracting(this::bookingStatus).containsExactly("CANCELLED", "APPROVED", "APPROVED");
        assertThat(jdbc.queryForList("SELECT title FROM bookings WHERE series_id = ? ORDER BY start_at", String.class, seriesId))
                .containsExactly("Øving", "Bare denne", "Øving");
    }

    // ── Edit this and following ─────────────────────────────────────

    @Test
    void anHourLaterAppliesToTheAnchorAndTheFollowingInLocalTime() throws Exception {
        UUID seriesId = series(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9), 4);
        List<UUID> ids = occurrences(seriesId);
        List<Instant> before = ids.stream().map(this::startOf).toList();

        UUID anchor = ids.get(1);
        editFollowing(KARI, seriesId, anchor, ROOM_A,
                        startOf(anchor).plus(Duration.ofHours(1)), startOf(anchor).plus(Duration.ofHours(3)), false, false)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.updated.length()").value(3))
                .andExpect(jsonPath("$.updated[0].title").value("Endret"))
                .andExpect(jsonPath("$.skipped.length()").value(0));

        assertThat(startOf(ids.get(0))).isEqualTo(before.get(0));
        for (int i = 1; i < 4; i++) {
            assertThat(local(startOf(ids.get(i)))).isEqualTo(local(before.get(i)).plusHours(1));
            assertThat(local(endOf(ids.get(i)))).isEqualTo(local(before.get(i)).plusHours(3));
        }
        assertThat(jdbc.queryForObject("SELECT title FROM bookings WHERE id = ?", String.class, ids.get(0))).isEqualTo("Øving");
    }

    @Test
    void movingEveryOccurrenceAWeekLaterDoesNotCollideWithItself() throws Exception {
        UUID seriesId = series(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9), 3);
        List<UUID> ids = occurrences(seriesId);
        List<Instant> before = ids.stream().map(this::startOf).toList();

        UUID anchor = ids.getFirst();
        Instant newStart = local(startOf(anchor)).plusWeeks(1).atZone(OSLO).toInstant();
        editFollowing(KARI, seriesId, anchor, ROOM_A, newStart, newStart.plus(Duration.ofHours(1)), false, false)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.updated.length()").value(3));
        for (int i = 0; i < 3; i++) {
            assertThat(local(startOf(ids.get(i)))).isEqualTo(local(before.get(i)).plusWeeks(1));
        }
    }

    @Test
    void takenTimesFailTheEditOrAreSkipped() throws Exception {
        UUID seriesId = series(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9), 4);
        List<UUID> ids = occurrences(seriesId);
        Instant thirdBefore = startOf(ids.get(2));
        // Blocks the third occurrence's new time (two hours later).
        createBooking(OLA, ROOM_A, ORG_B, thirdBefore.plus(Duration.ofHours(1)), thirdBefore.plus(Duration.ofHours(4)));

        UUID anchor = ids.get(1);
        Instant newStart = startOf(anchor).plus(Duration.ofHours(2));
        editFollowing(KARI, seriesId, anchor, ROOM_A, newStart, newStart.plus(Duration.ofHours(1)), false, false)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT"))
                .andExpect(jsonPath("$.conflicts.length()").value(1))
                .andExpect(jsonPath("$.conflicts[0].id").value(ids.get(2).toString()));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM bookings WHERE series_id = ? AND updated_at IS NOT NULL",
                Integer.class, seriesId)).isZero();

        // A dry run answers exactly like the real edit, without writing.
        editFollowing(KARI, seriesId, anchor, ROOM_A, newStart, newStart.plus(Duration.ofHours(1)), true, true)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.updated.length()").value(2))
                .andExpect(jsonPath("$.skipped[0].id").value(ids.get(2).toString()));
        assertThat(startOf(anchor)).isEqualTo(newStart.minus(Duration.ofHours(2)));
        assertThat(bookingVersion(anchor)).isZero();

        editFollowing(KARI, seriesId, anchor, ROOM_A, newStart, newStart.plus(Duration.ofHours(1)), true, false)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.updated.length()").value(2))
                .andExpect(jsonPath("$.skipped.length()").value(1));
        assertThat(startOf(anchor)).isEqualTo(newStart);
        assertThat(startOf(ids.get(2))).isEqualTo(thirdBefore);
    }

    @Test
    void movingApprovedRequestsMakesThemRequestsAgain() throws Exception {
        UUID seriesId = series(KARI, STORSALEN, ORG_A, at(7, 12), at(7, 14), 3);
        call(post("/api/bookings/series/" + seriesId + "/approve"), ADMIN, "{}").andExpect(status().isOk());
        List<UUID> ids = occurrences(seriesId);

        UUID anchor = ids.getFirst();
        editFollowing(KARI, seriesId, anchor, STORSALEN,
                        startOf(anchor).plus(Duration.ofHours(1)), endOf(anchor).plus(Duration.ofHours(1)), false, false)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.updated[0].status").value("PENDING"))
                .andExpect(jsonPath("$.updated[0].decidedAt").value(org.hamcrest.Matchers.nullValue()));
        assertThat(ids).extracting(this::bookingStatus).containsOnly("PENDING");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM bookings WHERE series_id = ? AND decided_by_id IS NOT NULL",
                Integer.class, seriesId)).isZero();

        // Into a direct room: approved at once.
        editFollowing(KARI, seriesId, anchor, ROOM_A, startOf(anchor), endOf(anchor), false, false)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.updated[2].status").value("APPROVED"))
                .andExpect(jsonPath("$.updated[2].roomName").value("Møterom A"));
    }

    @Test
    void editingFollowingOccurrencesNeedsTheRightToEditEachOne() throws Exception {
        UUID seriesId = series(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9), 3);
        List<UUID> ids = occurrences(seriesId);
        UUID anchor = ids.getFirst();
        UUID other = createBooking(KARI, ROOM_A, ORG_A, at(30, 8), at(30, 9));

        editFollowing(OLA, seriesId, anchor, ROOM_A, startOf(anchor), endOf(anchor), false, false)
                .andExpect(status().isForbidden());
        editFollowing(KARI, seriesId, other, ROOM_A, at(30, 8), at(30, 9), false, false).andExpect(status().isNotFound());
        call(put("/api/bookings/series/" + seriesId), KARI, """
                {"fromBookingId":"%s","version":3,"roomId":"%s","title":"X","start":"%s","end":"%s"}
                """.formatted(anchor, ROOM_A, startOf(anchor), endOf(anchor)))
                .andExpect(jsonPath("$.code").value("VERSION_CONFLICT"));
        // Organization B has no access to room B.
        UUID olas = series(OLA, ROOM_A, ORG_B, at(40, 8), at(40, 9), 2);
        UUID olaAnchor = occurrences(olas).getFirst();
        editFollowing(OLA, olas, olaAnchor, ROOM_B, startOf(olaAnchor), endOf(olaAnchor), false, false)
                .andExpect(jsonPath("$.code").value("NO_PERMISSION"));

        editFollowing(JONAS, seriesId, anchor, ROOM_A, startOf(anchor), endOf(anchor), false, false)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.updated.length()").value(3));
    }

    @Test
    void aSkippedOccurrenceCanBlockTheOneBeforeIt() throws Exception {
        UUID seriesId = series(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9), 4);
        List<UUID> ids = occurrences(seriesId);
        List<Instant> before = ids.stream().map(this::startOf).toList();

        // Everything moves one week and 30 minutes later: occurrence k lands half an hour into
        // occurrence k+1's old slot, which is fine as long as k+1 moves too. A booking that takes
        // the second occurrence's new time (but not the third's old one) makes the second stay,
        // and then the first can't move onto it either.
        Instant third = startOf(ids.get(2));
        createBooking(OLA, ROOM_A, ORG_B, third.plus(Duration.ofHours(1)), third.plus(Duration.ofHours(2)));

        UUID anchor = ids.getFirst();
        Instant newStart = local(startOf(anchor)).plusWeeks(1).plusMinutes(30).atZone(OSLO).toInstant();
        editFollowing(KARI, seriesId, anchor, ROOM_A, newStart, newStart.plus(Duration.ofHours(1)), false, false)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.conflicts.length()").value(2));

        editFollowing(KARI, seriesId, anchor, ROOM_A, newStart, newStart.plus(Duration.ofHours(1)), true, false)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.skipped.length()").value(2))
                .andExpect(jsonPath("$.skipped[0].id").value(ids.get(0).toString()))
                .andExpect(jsonPath("$.skipped[1].id").value(ids.get(1).toString()))
                .andExpect(jsonPath("$.updated.length()").value(2));
        assertThat(startOf(ids.get(0))).isEqualTo(before.get(0));
        assertThat(startOf(ids.get(1))).isEqualTo(before.get(1));
        for (int i = 2; i < 4; i++) {
            assertThat(local(startOf(ids.get(i)))).isEqualTo(local(before.get(i)).plusWeeks(1).plusMinutes(30));
        }
    }

    @Test
    void aSeriesWhoseRequesterIsGoneCannotBeMovedIntoRequests() throws Exception {
        UUID seriesId = series(KARI, ROOM_A, ORG_A, at(7, 8), at(7, 9), 2);
        UUID anchor = occurrences(seriesId).getFirst();

        jdbc.update("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?", KARI_ID, ORG_A);
        editFollowing(JONAS, seriesId, anchor, ROOM_B, startOf(anchor), endOf(anchor), false, false)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("ikke lenger medlem")));
        jdbc.update("INSERT INTO memberships (user_id, organization_id) VALUES (?, ?)", KARI_ID, ORG_A);

        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?", KARI_ID);
        editFollowing(JONAS, seriesId, anchor, ROOM_B, startOf(anchor), endOf(anchor), false, false)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("deaktivert")));

        assertThat(occurrences(seriesId)).extracting(this::bookingStatus).containsOnly("APPROVED");
        assertThat(jdbc.queryForList("SELECT DISTINCT room_id FROM bookings WHERE series_id = ?", UUID.class, seriesId))
                .containsExactly(ROOM_A);
    }
}
