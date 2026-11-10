package no.vtvest.booking.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import org.junit.jupiter.api.Test;

class ClosedHoursTest {

    private static final ZoneId OSLO = ZoneId.of("Europe/Oslo");

    private static boolean overlaps(String start, String end) {
        return ClosedHours.overlaps(at(start), at(end), OSLO);
    }

    private static Instant at(String time) {
        return OffsetDateTime.parse(time).toInstant();
    }

    @Test
    void mayEndAtFiveAndStartAtSeven() {
        assertThat(overlaps("2026-12-04T20:00+01:00", "2026-12-05T05:00+01:00")).isFalse();
        assertThat(overlaps("2026-12-05T07:00+01:00", "2026-12-05T12:00+01:00")).isFalse();
        assertThat(overlaps("2026-12-05T10:00+01:00", "2026-12-05T22:00+01:00")).isFalse();
    }

    @Test
    void anyOverlapWithTheWindowIsRefused() {
        assertThat(overlaps("2026-12-04T22:00+01:00", "2026-12-05T05:15+01:00")).isTrue();
        assertThat(overlaps("2026-12-05T06:45+01:00", "2026-12-05T10:00+01:00")).isTrue();
        assertThat(overlaps("2026-12-05T05:30+01:00", "2026-12-05T06:30+01:00")).isTrue();
        assertThat(overlaps("2026-12-05T04:00+01:00", "2026-12-05T08:00+01:00")).isTrue();
    }

    @Test
    void usesLocalTimeOnBothSidesOfDst() {
        // Summer time (UTC+2): 05:00 local is 03:00Z.
        assertThat(overlaps("2026-07-01T01:00:00Z", "2026-07-01T03:00:00Z")).isFalse();
        assertThat(overlaps("2026-07-01T01:00:00Z", "2026-07-01T03:30:00Z")).isTrue();
        // The night the clocks go back, 25 October 2026.
        assertThat(overlaps("2026-10-24T20:00+02:00", "2026-10-25T05:00+01:00")).isFalse();
        assertThat(overlaps("2026-10-24T20:00+02:00", "2026-10-25T05:30+01:00")).isTrue();
    }

    @Test
    void requireThrowsARuleViolation() {
        assertThatThrownBy(() -> ClosedHours.require(at("2026-12-05T06:00+01:00"), at("2026-12-05T09:00+01:00"), OSLO))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.RULE_VIOLATION));
    }
}
