package no.vtvest.booking.publicrequest;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.room.OpeningHours;

/** Request and response bodies for booking requests from the public form. */
final class PublicRequestDtos {

    private PublicRequestDtos() {}

    static final int MAX_CONTACTS = 10;

    /** Set by the system admin: ubehandlet, under arbeid, ferdig, avslått. Creating a booking sets DONE. */
    enum Status { NEW, IN_PROGRESS, DONE, REJECTED }

    /**
     * A person responsible at the event. {@code cardNumber} is the UiB card number, never the
     * student number. Spaces and hyphens in the card number and phone are removed.
     */
    record Contact(
            @NotBlank @Size(max = 100) String name,
            @NotBlank @Size(max = 120) String organization,
            @NotBlank @Size(max = 30) String cardNumber,
            @NotBlank @Size(max = 30) String phone) {}

    /**
     * What the public form sends. The browser turns date and times into start and end, past
     * midnight included. {@code preferredRoomId} null means no preference.
     */
    record SubmitPublicRequest(
            @NotBlank @Size(max = 254) String email,
            @NotBlank @Size(max = 120) String organizationName,
            @NotBlank @Size(max = 80) String eventName,
            @NotNull Boolean memberOfKulturstyretOrSamfunnet,
            UUID preferredRoomId,
            @NotNull OffsetDateTime start,
            @NotNull OffsetDateTime end,
            @NotBlank @Size(max = 2000) String description,
            @NotNull @Size(min = 1, max = MAX_CONTACTS) List<@NotNull @Valid Contact> contacts) {}

    /**
     * A system admin's edit of a request, at any status: the same fields as the form. The room can
     * be any room that isn't archived, or null for no preference. The linked booking is not changed.
     */
    record EditPublicRequest(
            @NotBlank @Size(max = 254) String email,
            @NotBlank @Size(max = 120) String organizationName,
            @NotBlank @Size(max = 80) String eventName,
            @NotNull Boolean memberOfKulturstyretOrSamfunnet,
            UUID preferredRoomId,
            @NotNull OffsetDateTime start,
            @NotNull OffsetDateTime end,
            @NotBlank @Size(max = 2000) String description,
            @NotNull @Size(min = 1, max = MAX_CONTACTS) List<@NotNull @Valid Contact> contacts) {}

    record SetStatus(@NotNull Status status) {}

    /** A room the public form offers: active and marked as requestable by an admin. */
    record PublicRoom(UUID id, String name, String description, Integer capacity, List<OpeningHours.Entry> openingHours) {}

    /** The number of unhandled (NEW) requests. */
    record PublicRequestCount(long count) {}

    record PublicRequest(
            UUID id,
            String email,
            String organizationName,
            String eventName,
            boolean memberOfKulturstyretOrSamfunnet,
            /** Null for no preference, or when the room has been deleted ({@code preferredRoomName} is kept). */
            UUID preferredRoomId,
            /** The room's current name, or its name when asked for if deleted; null for no preference. */
            String preferredRoomName,
            Instant start,
            Instant end,
            String description,
            /** Empty for requests sent before contacts were asked for. */
            List<Contact> contacts,
            Status status,
            Instant createdAt,
            UUID bookingId,
            /** The last edit or status change by an admin, or null. */
            Instant updatedAt,
            String updatedByName) {}
}
