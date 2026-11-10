package no.vtvest.booking.booking;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;

/**
 * No room can be used between 05:00 and 07:00 local time ({@code booking.time-zone}). A booking
 * may end at 05:00 or start at 07:00, but not overlap the window. Applies to every room and every
 * actor, system admins included, and to requests from the public form. Mirrored in bookingRules.ts.
 */
public final class ClosedHours {

    public static final LocalTime FROM = LocalTime.of(5, 0);
    public static final LocalTime TO = LocalTime.of(7, 0);
    public static final String MESSAGE =
            "Rommene kan ikke brukes mellom kl. 05:00 og 07:00. Velg et tidspunkt som slutter senest 05:00 eller starter tidligst 07:00.";

    private ClosedHours() {}

    /** Whether [start, end) overlaps 05:00–07:00 on any day. */
    public static boolean overlaps(Instant start, Instant end, ZoneId zone) {
        LocalDate last = end.atZone(zone).toLocalDate();
        for (LocalDate day = start.atZone(zone).toLocalDate(); !day.isAfter(last); day = day.plusDays(1)) {
            Instant from = day.atTime(FROM).atZone(zone).toInstant();
            Instant to = day.atTime(TO).atZone(zone).toInstant();
            if (start.isBefore(to) && end.isAfter(from)) {
                return true;
            }
        }
        return false;
    }

    public static void require(Instant start, Instant end, ZoneId zone) {
        if (overlaps(start, end, zone)) {
            throw new ApiException(ErrorCode.RULE_VIOLATION, MESSAGE);
        }
    }
}
