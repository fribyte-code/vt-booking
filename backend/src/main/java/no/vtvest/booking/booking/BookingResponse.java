package no.vtvest.booking.booking;

import java.time.Instant;
import java.util.UUID;

public record BookingResponse(
        UUID id,
        UUID roomId,
        /** Also for archived rooms, which GET /api/rooms leaves out. */
        String roomName,
        UUID organizationId,
        String organizationName,
        /** Only included for the booking's own organization and administrators. */
        UUID requestedById,
        /** Only included for the booking's own organization and administrators. */
        String requestedByName,
        String title,
        /** Only included for the booking's own organization and administrators. */
        String description,
        Instant start,
        Instant end,
        BookingStatus status,
        boolean requiresApproval,
        boolean ownOrganization,
        Instant createdAt,
        Instant decidedAt,
        /** Only included for the booking's own organization and administrators. */
        String decidedByName,
        /** Only included for the booking's own organization and administrators. */
        String decisionComment,
        Instant cancelledAt,
        /** Only included for the booking's own organization and administrators. */
        UUID cancelledById,
        /** Only included for the booking's own organization and administrators. */
        String cancelledByName,
        /** Only included for the booking's own organization and administrators. */
        String cancellationReason,
        /** When the booking was last edited, or null. */
        Instant updatedAt,
        /** Only included for the booking's own organization and administrators. */
        String updatedByName,
        /** Shared by the occurrences of a weekly series, otherwise null. */
        UUID seriesId,
        /** Send back with edit, approve, reject and cancel (optimistic locking). */
        int version) {}
