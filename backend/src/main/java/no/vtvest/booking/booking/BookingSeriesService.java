package no.vtvest.booking.booking;

import static no.vtvest.booking.booking.SeriesDtos.*;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.organization.Organization;
import no.vtvest.booking.room.Permission;
import no.vtvest.booking.room.OpeningHours;
import no.vtvest.booking.room.Room;
import no.vtvest.booking.user.User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionAspectSupport;

/**
 * Weekly series: several bookings created together that share a {@code series_id}. Each
 * occurrence is an ordinary booking under the same rules as {@link BookingService#create}, and can
 * be edited or cancelled on its own; the series operations here act on all of them at once.
 */
@Service
public class BookingSeriesService {

    static final int MIN_OCCURRENCES = 2;
    static final int MAX_OCCURRENCES = 52;
    private static final DateTimeFormatter NORWEGIAN_DATE = DateTimeFormatter.ofPattern("dd.MM.yyyy");

    private final BookingService bookingService;
    private final BookingRepository bookings;
    private final Clock clock;
    private final ZoneId zone;

    BookingSeriesService(
            BookingService bookingService,
            BookingRepository bookings,
            Clock clock,
            ZoneId zone) {
        this.bookingService = bookingService;
        this.bookings = bookings;
        this.clock = clock;
        this.zone = zone;
    }

    /** What {@link #create} would book, and which occurrences are taken. Writes nothing. */
    @Transactional(readOnly = true)
    public SeriesPreview preview(User actor, CreateSeriesRequest request) {
        List<Slot> slots = occurrences(request);
        Organization organization = bookingService.requireMembership(actor, request.organizationId(), false);
        Room room = bookingService.findBookableRoom(request.roomId());
        requireOpen(room, slots);
        bookingService.requirePermission(room, organization);
        List<Slot> conflicts = conflicts(room, slots);
        return new SeriesPreview(slots.stream()
                .map(s -> new PreviewOccurrence(s.start(), s.end(), conflicts.contains(s)))
                .toList());
    }

    /**
     * Creates every occurrence, APPROVED (DIRECT) or PENDING (REQUEST). If any is taken, nothing is
     * written and the error lists the taken times, unless {@code skipConflicts} is set: then only
     * the free ones are created. Membership and permission are the same for all occurrences.
     */
    @Transactional
    public SeriesCreated create(User actor, CreateSeriesRequest request) {
        List<Slot> slots = occurrences(request);
        Organization organization = bookingService.requireMembership(actor, request.organizationId(), true);
        Room room = bookingService.lockBookableRoom(request.roomId());
        requireOpen(room, slots);
        Permission permission = bookingService.requirePermission(room, organization);

        List<Slot> conflicts = conflicts(room, slots);
        if (!conflicts.isEmpty() && (!request.skip() || conflicts.size() == slots.size())) {
            String message = conflicts.size() == slots.size()
                    ? "Alle tidspunktene i serien er opptatt i " + room.getName() + "."
                    : conflicts.size() + " av " + slots.size() + " tidspunkter i serien er opptatt i " + room.getName() + ".";
            throw new ApiException(ErrorCode.CONFLICT, message, Map.of("conflicts", conflicts));
        }

        UUID seriesId = UUID.randomUUID();
        Instant now = clock.instant();
        String title = request.title().strip();
        String description = BookingService.blankToNull(request.description());
        List<Booking> created = slots.stream()
                .filter(s -> !conflicts.contains(s))
                .map(s -> new Booking(room.getId(), organization.getId(), actor.getId(), title, description,
                        s.start(), s.end(), permission == Permission.REQUEST, now, seriesId))
                .toList();
        bookingService.insert(created, room);
        return new SeriesCreated(
                seriesId, bookingService.toResponses(created, bookingService.viewerOf(actor)), conflicts);
    }

    /** The occurrences the actor may see, by start. A series without any is reported as not found. */
    @Transactional(readOnly = true)
    public List<BookingResponse> get(User actor, UUID seriesId) {
        Viewer viewer = bookingService.viewerOf(actor);
        return bookingService.toResponses(visibleOccurrences(seriesId, viewer), viewer);
    }

    /**
     * Cancels every approved or pending occurrence that has not started, or with
     * {@code fromBookingId} only that occurrence and the following ones. The actor must be allowed
     * to cancel each of them, otherwise nothing changes. Returns the cancelled ones.
     */
    @Transactional
    public List<BookingResponse> cancel(User actor, UUID seriesId, SeriesCancelRequest request) {
        List<Booking> series = lockSeries(seriesId);
        Viewer viewer = bookingService.viewerOf(actor);
        List<Booking> all = visible(series, viewer);
        Instant from = request.fromBookingId() == null
                ? Instant.MIN
                : anchor(all, request.fromBookingId()).getStartAt();
        Instant now = clock.instant();
        List<Booking> targets = series.stream()
                .filter(b -> BookingService.isOpenAndUpcoming(b, now) && !b.getStartAt().isBefore(from))
                .toList();
        if (targets.isEmpty()) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Serien har ingen kommende bookinger som kan kanselleres.");
        }
        for (Booking b : targets) {
            bookingService.requireChangeable(actor, b, null, now, BookingService.Change.CANCEL_SERIES);
        }
        String reason = BookingService.blankToNull(request.reason());
        targets.forEach(b -> b.cancel(actor.getId(), now, reason));
        bookingService.flush(null);
        return bookingService.toResponses(targets, viewer);
    }

    /**
     * Edits an occurrence and every following approved or pending occurrence that has not started.
     * The anchor's change is measured in local time: its start moves by some local shift (e.g. one
     * hour later, or one day later) and gets a new duration, and the following occurrences get the
     * same shift and duration in local time, so they keep matching wall-clock times across DST.
     * Room, title and description apply to all of them. Each occurrence follows exactly the rules
     * of {@link BookingService#update}. Occurrences whose new time is taken make the request fail,
     * or with {@code skipConflicts} are left unchanged and reported.
     */
    @Transactional
    public SeriesUpdated update(User actor, UUID seriesId, SeriesUpdateRequest request) {
        // Lock order, as for single bookings: membership and organization (shared), every room the
        // edit may touch (including the new one), and then the series' bookings by id.
        SeriesKeys keys = seriesKeys(seriesId);
        Organization organization = null;
        for (UUID requesterId : keys.requesterIds()) {
            organization = bookingService.lockForMove(requesterId, keys.organizationId());
        }
        Set<UUID> roomIds = new HashSet<>(keys.roomIds());
        roomIds.add(request.roomId());
        Map<UUID, Room> locked = bookingService.lockRooms(roomIds);
        List<Booking> series = lockSeries(seriesId);
        requireRoomsLocked(series, locked);

        Viewer viewer = bookingService.viewerOf(actor);
        Booking anchor = anchor(visible(series, viewer), request.fromBookingId());
        Instant now = clock.instant();
        bookingService.requireChangeable(actor, anchor, request.version(), now, BookingService.Change.EDIT);
        List<Booking> targets = series.stream()
                .filter(b -> BookingService.isOpenAndUpcoming(b, now) && !b.getStartAt().isBefore(anchor.getStartAt()))
                .sorted(Comparator.comparing(Booking::getStartAt))
                .toList();
        for (Booking b : targets) {
            bookingService.requireChangeable(actor, b, null, now, BookingService.Change.EDIT_SERIES);
        }

        Instant newStart = request.start().toInstant();
        Instant newEnd = request.end().toInstant();
        Map<Booking, Slot> plan = new LinkedHashMap<>();
        for (Booking b : targets) {
            Slot slot = b == anchor
                    ? new Slot(newStart, newEnd)
                    : shifted(zone, anchor.getStartAt(), newStart, newEnd, b.getStartAt());
            BookingService.validateTimes(slot.start(), slot.end(), now, zone);
            plan.put(b, slot);
        }
        List<Booking> moving = targets.stream()
                .filter(b -> !request.roomId().equals(b.getRoomId())
                        || !plan.get(b).start().equals(b.getStartAt())
                        || !plan.get(b).end().equals(b.getEndAt()))
                .toList();

        Room room = null;
        Permission permission = null;
        List<Booking> skipped = List.of();
        if (!moving.isEmpty()) {
            moving.forEach(b -> BookingService.requireMovableFrom(locked.get(b.getRoomId())));
            room = BookingService.requireMoveTarget(locked, request.roomId());
            requireOpen(room, moving.stream().map(plan::get).toList());
            permission = bookingService.requirePermission(room, organization);
            skipped = conflicting(room, moving, plan);
        }
        if (!skipped.isEmpty() && (!request.skip() || skipped.size() == targets.size())) {
            List<OccurrenceSlot> conflicts = skipped.stream()
                    .map(b -> new OccurrenceSlot(b.getId(), plan.get(b).start(), plan.get(b).end()))
                    .toList();
            String message = skipped.size() == targets.size()
                    ? "Alle de nye tidspunktene er opptatt i " + room.getName() + "."
                    : skipped.size() + " av " + targets.size() + " nye tidspunkter er opptatt i " + room.getName() + ".";
            throw new ApiException(ErrorCode.CONFLICT, message, Map.of("conflicts", conflicts));
        }

        String title = request.title().strip();
        String description = BookingService.blankToNull(request.description());
        Set<Booking> skippedSet = Set.copyOf(skipped);
        List<Booking> updated = targets.stream().filter(b -> !skippedSet.contains(b)).toList();
        // The rows are locked already. The exclusion constraint is checked row by row, though, so
        // write in the direction of the shift: moving everything a week later must not put one
        // occurrence on the next one's old slot.
        List<Booking> writeOrder = new ArrayList<>(updated);
        if (!localShift(zone, anchor.getStartAt(), newStart).isNegative()) {
            Collections.reverse(writeOrder);
        }
        for (Booking b : writeOrder) {
            b.editText(title, description, actor.getId(), now);
            if (moving.contains(b)) {
                bookingService.applyMove(b, room, permission, plan.get(b).start(), plan.get(b).end(), actor, now);
            }
            bookingService.flush(room);
        }
        if (request.dry()) {
            TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
        }
        List<OccurrenceSlot> skippedSlots = skipped.stream()
                .map(b -> new OccurrenceSlot(b.getId(), plan.get(b).start(), plan.get(b).end()))
                .toList();
        return new SeriesUpdated(bookingService.toResponses(updated, viewer), skippedSlots);
    }

    /**
     * System admins and the rooms' managers: approves every unexpired pending occurrence, re-checking everything a
     * single approval checks. The requester's membership and account apply to the whole series and
     * fail the request; permission and conflicts are per occurrence (occurrences may have been
     * moved to other rooms), and those that fail are returned in {@code notApproved}.
     */
    @Transactional
    public SeriesApproved approve(User actor, UUID seriesId, SeriesApproveRequest request) {
        Viewer viewer = bookingService.viewerOf(actor);
        BookingService.requireMayDecideAny(viewer);
        // Rooms first, then the bookings by id: the same order as every other write.
        Map<UUID, Room> lockedRooms = bookingService.lockRooms(seriesKeys(seriesId).roomIds());
        List<Booking> series = lockSeries(seriesId);
        requireRoomsLocked(series, lockedRooms);
        List<Booking> targets = pendingOccurrences(series);
        targets.forEach(b -> BookingService.requireMayDecide(viewer, b));
        bookingService.requireRequesterMayStillBook(targets.getFirst());

        Instant now = clock.instant();
        String comment = BookingService.blankToNull(request.comment());
        List<Booking> approved = new ArrayList<>();
        List<NotApproved> notApproved = new ArrayList<>();
        for (Booking b : targets) {
            Room room = lockedRooms.get(b.getRoomId());
            ApiException problem = bookingService.approvalProblem(b, room);
            if (problem != null) {
                notApproved.add(new NotApproved(b.getId(), b.getStartAt(), b.getEndAt(), problem.code(), problem.getMessage()));
                continue;
            }
            b.approve(actor.getId(), now, comment);
            // Written now, so the next occurrence's conflict check sees it.
            bookingService.flush(room);
            approved.add(b);
        }
        return new SeriesApproved(bookingService.toResponses(approved, viewer), notApproved);
    }

    /** System admins and the rooms' managers: rejects every unexpired pending occurrence. Returns the rejected ones. */
    @Transactional
    public List<BookingResponse> reject(User actor, UUID seriesId, SeriesRejectRequest request) {
        Viewer viewer = bookingService.viewerOf(actor);
        BookingService.requireMayDecideAny(viewer);
        List<Booking> targets = pendingOccurrences(lockSeries(seriesId));
        targets.forEach(b -> BookingService.requireMayDecide(viewer, b));
        Instant now = clock.instant();
        String reason = request.reason().strip();
        targets.forEach(b -> b.reject(actor.getId(), now, reason));
        bookingService.flush(null);
        return bookingService.toResponses(targets, viewer);
    }

    /** The occurrence of the series that an operation starts from. */
    private static Booking anchor(List<Booking> visibleOccurrences, UUID bookingId) {
        return visibleOccurrences.stream()
                .filter(b -> b.getId().equals(bookingId))
                .findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Bookingen finnes ikke i serien."));
    }

    /**
     * The moving occurrences whose new time in {@code room} overlaps an approved booking. Moving
     * occurrences don't block each other, since they leave their old slots; but one that is
     * skipped stays where it is, and may then block another, so this repeats until it settles.
     */
    private List<Booking> conflicting(Room room, List<Booking> moving, Map<Booking, Slot> plan) {
        Instant from = moving.stream().map(b -> plan.get(b).start()).min(Comparator.naturalOrder()).orElseThrow();
        Instant to = moving.stream().map(b -> plan.get(b).end()).max(Comparator.naturalOrder()).orElseThrow();
        Set<UUID> movingIds = moving.stream().map(Booking::getId).collect(Collectors.toSet());
        List<Slot> occupied = new ArrayList<>(bookings.findInRangeForRoom(room.getId(), List.of(BookingStatus.APPROVED), from, to)
                .stream()
                .filter(b -> !movingIds.contains(b.getId()))
                .map(b -> new Slot(b.getStartAt(), b.getEndAt()))
                .toList());
        List<Booking> skipped = new ArrayList<>();
        boolean changed = true;
        while (changed) {
            changed = false;
            for (Booking b : moving) {
                Slot slot = plan.get(b);
                if (!skipped.contains(b) && occupied.stream().anyMatch(o -> overlaps(o, slot))) {
                    skipped.add(b);
                    if (b.getStatus() == BookingStatus.APPROVED && b.getRoomId().equals(room.getId())) {
                        occupied.add(new Slot(b.getStartAt(), b.getEndAt()));
                    }
                    changed = true;
                }
            }
        }
        skipped.sort(Comparator.comparing(Booking::getStartAt));
        return skipped;
    }

    private static boolean overlaps(Slot a, Slot b) {
        return a.start().isBefore(b.end()) && a.end().isAfter(b.start());
    }

    private List<Booking> visibleOccurrences(UUID seriesId, Viewer viewer) {
        return visible(bookings.findBySeriesIdOrderByStartAt(seriesId), viewer);
    }

    /** The occurrences the actor may see, by start; a series without any is not found. */
    private static List<Booking> visible(List<Booking> series, Viewer viewer) {
        List<Booking> visible = series.stream()
                .filter(viewer::sees)
                .sorted(Comparator.comparing(Booking::getStartAt))
                .toList();
        if (visible.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Serien finnes ikke.");
        }
        return visible;
    }

    /**
     * Every occurrence, locked (SELECT … FOR UPDATE, by id) before the write looks at them, so
     * concurrent series writes take the rows in the same order. Returned by start.
     */
    private List<Booking> lockSeries(UUID seriesId) {
        List<Booking> series = new ArrayList<>(bookings.lockSeries(seriesId));
        series.sort(Comparator.comparing(Booking::getStartAt));
        return series;
    }

    private record SeriesKeys(Set<UUID> roomIds, UUID organizationId, Set<UUID> requesterIds) {}

    /** What a series write must lock before its bookings. A series without bookings is not found. */
    private SeriesKeys seriesKeys(UUID seriesId) {
        List<Object[]> rows = bookings.seriesKeys(seriesId);
        if (rows.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Serien finnes ikke.");
        }
        return new SeriesKeys(
                rows.stream().map(r -> (UUID) r[0]).collect(Collectors.toCollection(TreeSet::new)),
                (UUID) rows.getFirst()[1],
                rows.stream().map(r -> (UUID) r[2]).collect(Collectors.toCollection(TreeSet::new)));
    }

    /**
     * The rooms were read before the bookings were locked; if an occurrence was moved to another
     * room in between, the caller holds the wrong room locks and must start over.
     */
    private static void requireRoomsLocked(List<Booking> series, Map<UUID, Room> locked) {
        if (!series.stream().allMatch(b -> locked.containsKey(b.getRoomId()))) {
            throw new ApiException(
                    ErrorCode.VERSION_CONFLICT, "Serien ble endret av noen andre samtidig. Last inn på nytt og prøv igjen.");
        }
    }

    /**
     * Where an occurrence goes when the anchor moves to [newStart, newEnd): its start gets the
     * anchor's shift in local time (an hour later, a day later, ... on the wall clock, across DST),
     * and it lasts as long as the anchor's new time, as an absolute duration.
     */
    static Slot shifted(ZoneId zone, Instant anchorStart, Instant newStart, Instant newEnd, Instant occurrenceStart) {
        Instant start = occurrenceStart.atZone(zone).toLocalDateTime()
                .plus(localShift(zone, anchorStart, newStart))
                .atZone(zone)
                .toInstant();
        return new Slot(start, start.plus(Duration.between(newStart, newEnd)));
    }

    private static Duration localShift(ZoneId zone, Instant from, Instant to) {
        return Duration.between(from.atZone(zone).toLocalDateTime(), to.atZone(zone).toLocalDateTime());
    }

    /** Pending occurrences that can still be decided (not started). Admins only, so no visibility filter. */
    private List<Booking> pendingOccurrences(List<Booking> series) {
        if (series.isEmpty()) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Serien finnes ikke.");
        }
        Instant now = clock.instant();
        List<Booking> pending = series.stream()
                .filter(b -> b.getStatus() == BookingStatus.PENDING && b.getStartAt().isAfter(now))
                .toList();
        if (pending.isEmpty()) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Serien har ingen ubehandlede søknader.");
        }
        return pending;
    }

    /**
     * The occurrences, every {@code intervalWeeks} weeks from the first up to and including
     * {@code until}. They are computed in the local zone, so 18:00–20:00 stays 18:00–20:00 local
     * time across daylight saving changes. Each must satisfy the single-booking time rules.
     */
    List<Slot> occurrences(CreateSeriesRequest request) {
        ZonedDateTime firstStart = request.start().atZoneSameInstant(zone);
        ZonedDateTime firstEnd = request.end().atZoneSameInstant(zone);
        int step = request.recurrence().intervalWeeks();
        LocalDate until = request.recurrence().until();

        List<Slot> slots = new ArrayList<>();
        for (int i = 0; ; i++) {
            ZonedDateTime start = firstStart.plusWeeks((long) i * step);
            if (start.toLocalDate().isAfter(until)) {
                break;
            }
            if (slots.size() == MAX_OCCURRENCES) {
                throw new ApiException(
                        ErrorCode.RULE_VIOLATION, "En serie kan ha maks " + MAX_OCCURRENCES + " forekomster. Velg en tidligere sluttdato.");
            }
            slots.add(new Slot(start.toInstant(), firstEnd.plusWeeks((long) i * step).toInstant()));
        }
        if (slots.size() < MIN_OCCURRENCES) {
            throw new ApiException(ErrorCode.VALIDATION, "En serie må ha minst to forekomster. Velg en senere sluttdato.");
        }

        Instant now = clock.instant();
        Instant latest = now.plus(BookingService.MAX_ADVANCE);
        if (slots.getLast().start().isAfter(latest)) {
            throw new ApiException(ErrorCode.RULE_VIOLATION,
                    "Serien går for langt frem i tid. Du kan booke maks " + BookingService.MAX_ADVANCE.toDays()
                            + " dager frem, det vil si til og med " + NORWEGIAN_DATE.format(latest.atZone(zone)) + ".");
        }
        for (Slot slot : slots) {
            BookingService.validateTimes(slot.start(), slot.end(), now, zone);
        }
        return slots;
    }

    /** Occurrences that overlap an approved booking (half-open intervals, as the exclusion constraint). */
    private List<Slot> conflicts(Room room, List<Slot> slots) {
        List<Slot> approved = bookings.findInRangeForRoom(
                        room.getId(), List.of(BookingStatus.APPROVED), slots.getFirst().start(), slots.getLast().end())
                .stream()
                .map(b -> new Slot(b.getStartAt(), b.getEndAt()))
                .toList();
        return slots.stream().filter(s -> approved.stream().anyMatch(a -> overlaps(a, s))).toList();
    }

    /** Every occurrence must lie within the room's opening hours. */
    private void requireOpen(Room room, List<Slot> slots) {
        List<OpeningHours.Interval> hours = bookingService.openingHoursOf(room);
        slots.forEach(s -> OpeningHours.require(room.getName(), hours, s.start(), s.end(), zone));
    }
}
