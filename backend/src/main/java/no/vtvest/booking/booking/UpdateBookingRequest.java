package no.vtvest.booking.booking;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Input for editing a booking. The organization, requester and status cannot be changed: there
 * are no such fields, and the new status follows from the room permission. {@code version} must
 * match the booking the user looked at (optimistic locking).
 */
public record UpdateBookingRequest(
        @NotNull Integer version,
        @NotNull UUID roomId,
        @NotBlank @Size(max = 80) String title,
        @Size(max = 500) String description,
        @NotNull OffsetDateTime start,
        @NotNull OffsetDateTime end) {}
