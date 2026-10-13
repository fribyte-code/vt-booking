package no.vtvest.booking.booking;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** {@code version} must match the booking the admin looked at (optimistic locking). */
public record RejectBookingRequest(@NotNull Integer version, @NotBlank @Size(max = 300) String reason) {}
