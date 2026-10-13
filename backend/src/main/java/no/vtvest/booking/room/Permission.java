package no.vtvest.booking.room;

/** An organization's booking right for a room. */
public enum Permission {
    /** Bookings are confirmed immediately. */
    DIRECT,
    /** Bookings are requests that an administrator must approve. */
    REQUEST,
    /** The organization cannot book the room. */
    NONE
}
