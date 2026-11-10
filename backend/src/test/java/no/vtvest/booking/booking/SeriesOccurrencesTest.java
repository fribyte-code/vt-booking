package no.vtvest.booking.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;
import no.vtvest.booking.booking.SeriesDtos.CreateSeriesRequest;
import no.vtvest.booking.booking.SeriesDtos.Recurrence;
import no.vtvest.booking.booking.SeriesDtos.Slot;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import org.junit.jupiter.api.Test;

/**
 * Occurrence generation and the "this and following" shift, on fixed dates around the end of
 * summer time (25 October 2026), so daylight saving changes are tested on known dates.
 */
class SeriesOccurrencesTest {

    private static final ZoneId OSLO = ZoneId.of("Europe/Oslo");
    private final BookingSeriesService service = new BookingSeriesService(
            null, null, Clock.fixed(Instant.parse("2026-10-01T10:00:00Z"), ZoneOffset.UTC), OSLO);

    private static CreateSeriesRequest request(String start, String end, int intervalWeeks, String until) {
        return new CreateSeriesRequest(UUID.randomUUID(), UUID.randomUUID(), "Øving", null,
                OffsetDateTime.parse(start), OffsetDateTime.parse(end), new Recurrence(intervalWeeks, LocalDate.parse(until)), false);
    }

    @Test
    void occurrencesKeepTheirLocalTimeAcrossTheEndOfSummerTime() {
        // Summer time ends on 25 October 2026: 18:00 local is 16:00Z before and 17:00Z after.
        assertThat(service.occurrences(request("2026-10-20T18:00+02:00", "2026-10-20T20:00+02:00", 1, "2026-11-03")))
                .containsExactly(
                        new Slot(Instant.parse("2026-10-20T16:00:00Z"), Instant.parse("2026-10-20T18:00:00Z")),
                        new Slot(Instant.parse("2026-10-27T17:00:00Z"), Instant.parse("2026-10-27T19:00:00Z")),
                        new Slot(Instant.parse("2026-11-03T17:00:00Z"), Instant.parse("2026-11-03T19:00:00Z")));
    }

    @Test
    void intervalAndInclusiveEndDate() {
        assertThat(service.occurrences(request("2026-10-05T09:00+02:00", "2026-10-05T10:00+02:00", 2, "2026-11-02")))
                .extracting(s -> s.start().atZone(OSLO).toLocalDate().toString())
                .containsExactly("2026-10-05", "2026-10-19", "2026-11-02");
    }

    @Test
    void seriesNeedTwoToFiftyTwoOccurrences() {
        assertThatThrownBy(() -> service.occurrences(request("2026-10-05T09:00+02:00", "2026-10-05T10:00+02:00", 1, "2026-10-11")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.VALIDATION));
        assertThatThrownBy(() -> service.occurrences(request("2026-10-05T09:00+02:00", "2026-10-05T10:00+02:00", 1, "2027-12-31")))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.code()).isEqualTo(ErrorCode.RULE_VIOLATION);
                    assertThat(e.getMessage()).contains("52");
                });
    }

    @Test
    void theLastOccurrenceMustBeWithinTheBookingHorizon() {
        // 180 days after 1 October 2026 is 30 March 2027.
        assertThatThrownBy(() -> service.occurrences(request("2027-03-01T09:00+01:00", "2027-03-01T10:00+01:00", 1, "2027-04-15")))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.code()).isEqualTo(ErrorCode.RULE_VIOLATION);
                    assertThat(e.getMessage()).contains("180 dager").contains("30.03.2027");
                });
    }

    @Test
    void everyOccurrenceFollowsTheSingleBookingRules() {
        assertThatThrownBy(() -> service.occurrences(request("2026-09-30T09:00+02:00", "2026-09-30T10:00+02:00", 1, "2026-10-14")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.VALIDATION));
        assertThatThrownBy(() -> service.occurrences(request("2026-10-05T06:00+02:00", "2026-10-05T19:00+02:00", 1, "2026-10-19")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.RULE_VIOLATION));
        // 06:30 local is inside the closed hours (05:00–07:00).
        assertThatThrownBy(() -> service.occurrences(request("2026-10-05T06:30+02:00", "2026-10-05T08:00+02:00", 1, "2026-10-19")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.RULE_VIOLATION));
    }

    // ── Shifting the following occurrences ──────────────────────────

    private static Slot shift(String anchorStart, String newStart, String newEnd, String occurrenceStart) {
        return BookingSeriesService.shifted(OSLO, Instant.parse(anchorStart), Instant.parse(newStart),
                Instant.parse(newEnd), Instant.parse(occurrenceStart));
    }

    @Test
    void anHourLaterStaysAnHourLaterOnTheWallClockAcrossDst() {
        // Anchor Tuesday 20 Oct 18:00 local (16:00Z) moves to 19:00–21:00 local.
        // The next Tuesday, 27 Oct 18:00 local, is 17:00Z after the change; it must become 19:00 local = 18:00Z.
        assertThat(shift("2026-10-20T16:00:00Z", "2026-10-20T17:00:00Z", "2026-10-20T19:00:00Z", "2026-10-27T17:00:00Z"))
                .isEqualTo(new Slot(Instant.parse("2026-10-27T18:00:00Z"), Instant.parse("2026-10-27T20:00:00Z")));
        assertThat(shift("2026-10-20T16:00:00Z", "2026-10-20T17:00:00Z", "2026-10-20T19:00:00Z", "2026-11-03T17:00:00Z"))
                .isEqualTo(new Slot(Instant.parse("2026-11-03T18:00:00Z"), Instant.parse("2026-11-03T20:00:00Z")));
    }

    @Test
    void tuesdayToWednesdayKeepsTheLocalTimeAcrossDst() {
        // Anchor Tuesday 20 Oct 18:00 local moves to Wednesday 21 Oct 18:00–20:00 local.
        assertThat(shift("2026-10-20T16:00:00Z", "2026-10-21T16:00:00Z", "2026-10-21T18:00:00Z", "2026-10-27T17:00:00Z"))
                .isEqualTo(new Slot(Instant.parse("2026-10-28T17:00:00Z"), Instant.parse("2026-10-28T19:00:00Z")));
    }

    @Test
    void theNewDurationIsAnAbsoluteDuration() {
        // Anchor Saturday 17 Oct 23:00–03:00 local: four hours. The next Saturday, 24 Oct 23:00 local
        // (21:00Z), spans the night the clocks go back, and still lasts four hours: until 02:00 local (01:00Z).
        assertThat(shift("2026-10-17T21:00:00Z", "2026-10-17T21:00:00Z", "2026-10-18T01:00:00Z", "2026-10-24T21:00:00Z"))
                .isEqualTo(new Slot(Instant.parse("2026-10-24T21:00:00Z"), Instant.parse("2026-10-25T01:00:00Z")));
    }
}
