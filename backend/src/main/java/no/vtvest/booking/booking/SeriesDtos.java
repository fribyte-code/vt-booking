package no.vtvest.booking.booking;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.common.ErrorCode;

/** Request and response bodies for weekly booking series. */
public final class SeriesDtos {

    private SeriesDtos() {}

    /** Every {@code intervalWeeks} weeks, up to and including the local date {@code until}. */
    public record Recurrence(@NotNull @Min(1) @Max(4) Integer intervalWeeks, @NotNull LocalDate until) {}

    /**
     * {@code start} and {@code end} are the first occurrence. Like a single booking, there is no
     * requester or status field. {@code skipConflicts} (default false) is only used when creating.
     */
    public record CreateSeriesRequest(
            @NotNull UUID roomId,
            @NotNull UUID organizationId,
            @NotBlank @Size(max = 80) String title,
            @Size(max = 500) String description,
            @NotNull OffsetDateTime start,
            @NotNull OffsetDateTime end,
            @NotNull @Valid Recurrence recurrence,
            Boolean skipConflicts) {

        boolean skip() {
            return Boolean.TRUE.equals(skipConflicts);
        }
    }

    public record Slot(Instant start, Instant end) {}

    /** {@code conflict}: the time overlaps an approved booking, so it can't be booked or requested. */
    public record PreviewOccurrence(Instant start, Instant end, boolean conflict) {}

    public record SeriesPreview(List<PreviewOccurrence> occurrences) {}

    public record SeriesCreated(UUID seriesId, List<BookingResponse> created, List<Slot> skipped) {}

    /** Without {@code fromBookingId}: every future occurrence. With it: that occurrence and the following ones. */
    public record SeriesCancelRequest(UUID fromBookingId, @Size(max = 300) String reason) {}

    /**
     * Edits {@code fromBookingId} and the following occurrences. {@code start}, {@code end} and
     * {@code version} are for that occurrence; the others get the same local-time shift and
     * duration. {@code skipConflicts} and {@code dryRun} default to false. With {@code dryRun} nothing is written (the response's versions are then not valid).
     */
    public record SeriesUpdateRequest(
            @NotNull UUID fromBookingId,
            @NotNull Integer version,
            @NotNull UUID roomId,
            @NotBlank @Size(max = 80) String title,
            @Size(max = 500) String description,
            @NotNull OffsetDateTime start,
            @NotNull OffsetDateTime end,
            Boolean skipConflicts,
            Boolean dryRun) {

        boolean skip() {
            return Boolean.TRUE.equals(skipConflicts);
        }

        boolean dry() {
            return Boolean.TRUE.equals(dryRun);
        }
    }

    /** An occurrence and the new time it would have got. */
    public record OccurrenceSlot(UUID id, Instant start, Instant end) {}

    public record SeriesUpdated(List<BookingResponse> updated, List<OccurrenceSlot> skipped) {}

    public record SeriesApproveRequest(@Size(max = 300) String comment) {}

    public record SeriesRejectRequest(@NotBlank @Size(max = 300) String reason) {}

    /** A pending occurrence that could not be approved, with the same code and message a single approval would give. */
    public record NotApproved(UUID id, Instant start, Instant end, ErrorCode code, String reason) {}

    public record SeriesApproved(List<BookingResponse> approved, List<NotApproved> notApproved) {}
}
