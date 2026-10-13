package no.vtvest.booking.booking;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** {@code version} must match the booking the user looked at (optimistic locking). */
public record CancelBookingRequest(@NotNull Integer version, @Size(max = 300) String reason) {}
