package no.vtvest.booking.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import no.vtvest.booking.common.ApiException;
import org.junit.jupiter.api.Test;

class OpeningHoursTest {

    private static final ZoneId OSLO = ZoneId.of("Europe/Oslo");
    // UiB-kantina: weekdays 16:30–24:00, weekends 08:00–16:00.
    private static final List<OpeningHours.Interval> CANTEEN = OpeningHours.parse(List.of(
            new OpeningHours.Entry(DayOfWeek.SATURDAY, "08:00", "16:00"),
            new OpeningHours.Entry(DayOfWeek.MONDAY, "16:30", "24:00"),
            new OpeningHours.Entry(DayOfWeek.TUESDAY, "16:30", "24:00"),
            new OpeningHours.Entry(DayOfWeek.WEDNESDAY, "16:30", "24:00"),
            new OpeningHours.Entry(DayOfWeek.THURSDAY, "16:30", "24:00"),
            new OpeningHours.Entry(DayOfWeek.FRIDAY, "16:30", "24:00"),
            new OpeningHours.Entry(DayOfWeek.SUNDAY, "08:00", "16:00")));

    private static boolean allows(List<OpeningHours.Interval> hours, String start, String end) {
        return OpeningHours.allows(hours, at(start), at(end), OSLO);
    }

    private static Instant at(String time) {
        return OffsetDateTime.parse(time).toInstant();
    }

    @Test
    void withoutHoursEverythingIsAllowed() {
        assertThat(allows(List.of(), "2026-12-01T01:00+01:00", "2026-12-01T04:00+01:00")).isTrue();
    }

    @Test
    void bookingsMustFitTheirStartDaysInterval() {
        // Tuesday 1 December 2026, Saturday 5 December.
        assertThat(allows(CANTEEN, "2026-12-01T16:30+01:00", "2026-12-01T20:00+01:00")).isTrue();
        assertThat(allows(CANTEEN, "2026-12-01T18:00+01:00", "2026-12-02T00:00+01:00")).isTrue();
        assertThat(allows(CANTEEN, "2026-12-01T16:00+01:00", "2026-12-01T18:00+01:00")).isFalse();
        assertThat(allows(CANTEEN, "2026-12-01T20:00+01:00", "2026-12-02T01:00+01:00")).isFalse();
        assertThat(allows(CANTEEN, "2026-12-05T08:00+01:00", "2026-12-05T16:00+01:00")).isTrue();
        assertThat(allows(CANTEEN, "2026-12-05T15:00+01:00", "2026-12-05T17:00+01:00")).isFalse();
        // A day without a row is closed.
        List<OpeningHours.Interval> saturdays = OpeningHours.parse(List.of(new OpeningHours.Entry(DayOfWeek.SATURDAY, "08:00", "16:00")));
        assertThat(allows(saturdays, "2026-12-01T10:00+01:00", "2026-12-01T11:00+01:00")).isFalse();
    }

    @Test
    void describesConsecutiveDaysWithTheSameHoursTogether() {
        assertThat(OpeningHours.describe(CANTEEN)).isEqualTo("man–fre 16:30–24:00, lør–søn 08:00–16:00");
        assertThat(OpeningHours.describe(OpeningHours.parse(List.of(
                new OpeningHours.Entry(DayOfWeek.MONDAY, "08:00", "16:00"),
                new OpeningHours.Entry(DayOfWeek.WEDNESDAY, "08:00", "16:00")))))
                .isEqualTo("man 08:00–16:00, ons 08:00–16:00");
    }

    @Test
    void parseRefusesInvalidEntries() {
        assertThatThrownBy(() -> OpeningHours.parse(List.of(new OpeningHours.Entry(DayOfWeek.MONDAY, "24:00", "24:00"))))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> OpeningHours.parse(List.of(new OpeningHours.Entry(DayOfWeek.MONDAY, "08:00", "25:00"))))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> OpeningHours.parse(List.of(new OpeningHours.Entry(null, "08:00", "16:00"))))
                .isInstanceOf(ApiException.class);
        assertThat(OpeningHours.toEntries(OpeningHours.parse(List.of(new OpeningHours.Entry(DayOfWeek.MONDAY, " 08:05 ", "24:00")))))
                .containsExactly(new OpeningHours.Entry(DayOfWeek.MONDAY, "08:05", "24:00"));
    }
}
