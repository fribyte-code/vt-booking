package no.vtvest.booking.room;

public enum RoomStatus {
    ACTIVE,
    /** Visible but not bookable, e.g. during renovation. */
    DISABLED,
    ARCHIVED
}
