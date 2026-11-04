package no.vtvest.booking.publicrequest;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.UUID;

/** Request and response bodies for booking requests from the public form. */
final class PublicRequestDtos {

    private PublicRequestDtos() {}

    enum Status { NEW, TRANSFERRED, REJECTED }

    /** The common area asked for. Only these two are offered in the public form for now. */
    enum PreferredArea { FESTPLASSEN, TORGALLMENNINGEN, NO_PREFERENCE }

    /** What the public form sends. The browser turns date and times into start and end, past midnight included. */
    record SubmitPublicRequest(
            @NotBlank @Size(max = 254) String email,
            @NotBlank @Size(max = 120) String organizationName,
            @NotBlank @Size(max = 80) String eventName,
            @NotNull Boolean memberOfKulturstyretOrSamfunnet,
            @NotNull PreferredArea preferredArea,
            @NotNull OffsetDateTime start,
            @NotNull OffsetDateTime end,
            @NotBlank @Size(max = 2000) String description,
            @NotNull Boolean needsVillaGuard) {}

    record PublicRequest(
            UUID id,
            String email,
            String organizationName,
            String eventName,
            boolean memberOfKulturstyretOrSamfunnet,
            PreferredArea preferredArea,
            Instant start,
            Instant end,
            String description,
            boolean needsVillaGuard,
            Status status,
            Instant createdAt,
            UUID bookingId) {}
}
