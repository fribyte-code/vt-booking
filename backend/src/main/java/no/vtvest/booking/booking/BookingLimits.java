package no.vtvest.booking.booking;

import java.time.Duration;

/** Limits shared by every kind of booking, request and public request (mirrored in the frontend's bookingRules.ts). */
public final class BookingLimits {

    private BookingLimits() {}

    /**
     * The longest a booking, a request or a public request can last: 07:00 to 05:00 the next day,
     * the longest the closed hours (05:00–07:00) leave. Together with them, nothing can hold a room
     * across several days (the reason for a limit, from the prototype's security audit).
     */
    public static final Duration MAX_DURATION = Duration.ofHours(22);

    /** "22 timer", for messages. */
    public static String maxDurationText() {
        return MAX_DURATION.toHours() + " timer";
    }
}
