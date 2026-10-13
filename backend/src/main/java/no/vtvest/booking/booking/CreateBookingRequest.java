package no.vtvest.booking.booking;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Input for creating a booking. There is deliberately no requester or status field:
 * the requester is the session user and the status follows from the room permission.
 */
public record CreateBookingRequest(
        @NotNull UUID roomId,
        @NotNull UUID organizationId,
        @NotBlank @Size(max = 80) String title,
        @Size(max = 500) String description,
        @NotNull OffsetDateTime start,
        @NotNull OffsetDateTime end) {}
