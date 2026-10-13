package no.vtvest.booking.booking;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Stream;
import java.util.stream.Collectors;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.organization.Membership;
import no.vtvest.booking.organization.MembershipId;
import no.vtvest.booking.organization.MembershipRepository;
import no.vtvest.booking.organization.MembershipRole;
import no.vtvest.booking.organization.Organization;
import no.vtvest.booking.organization.OrganizationRepository;
import no.vtvest.booking.room.Permission;
import no.vtvest.booking.room.Room;
import no.vtvest.booking.room.RoomRepository;
import no.vtvest.booking.room.RoomService;
import no.vtvest.booking.room.RoomStatus;
import no.vtvest.booking.user.User;
import no.vtvest.booking.user.UserRepository;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Booking rules, enforced on every write. Ported from the prototype's
 * frontend/src/services/bookingRules.ts, plus duration and
 * horizon limits (SECURITY_AUDIT VULN-03), and the approval workflow. The database exclusion constraint
 * is the final guarantee against double booking under concurrency.
 */
@Service
public class BookingService {

    static final Duration MAX_DURATION = Duration.ofHours(12);
    static final Duration MAX_ADVANCE = Duration.ofDays(180);
    static final Duration MAX_QUERY_RANGE = Duration.ofDays(62);
    /** How far back "my bookings" reaches. */
    static final Duration MY_HISTORY = Duration.ofDays(90);

    private static final String EXCLUSION_VIOLATION = "23P01";
    private static final List<BookingStatus> CALENDAR_STATUSES = List.of(BookingStatus.APPROVED, BookingStatus.PENDING);

    private final BookingRepository bookings;
    private final RoomRepository rooms;
    private final RoomService roomService;
    private final OrganizationRepository organizations;
    private final MembershipRepository memberships;
    private final UserRepository users;
    private final Clock clock;

    BookingService(
            BookingRepository bookings,
            RoomRepository rooms,
            RoomService roomService,
            OrganizationRepository organizations,
            MembershipRepository memberships,
            UserRepository users,
            Clock clock) {
        this.bookings = bookings;
        this.rooms = rooms;
        this.roomService = roomService;
        this.organizations = organizations;
        this.memberships = memberships;
        this.users = users;
        this.clock = clock;
    }

    @Transactional
    public BookingResponse create(User actor, CreateBookingRequest request) {
        Instant start = request.start().toInstant();
        Instant end = request.end().toInstant();
        Instant now = clock.instant();

        if (!end.isAfter(start)) {
            throw new ApiException(ErrorCode.VALIDATION, "Sluttidspunktet må være etter starttidspunktet.");
        }
        if (start.isBefore(now)) {
            throw new ApiException(ErrorCode.VALIDATION, "Du kan ikke booke et tidspunkt som har passert.");
        }
        if (Duration.between(start, end).compareTo(MAX_DURATION) > 0) {
            throw new ApiException(ErrorCode.RULE_VIOLATION, "En booking kan vare maks 12 timer.");
        }
        if (start.isAfter(now.plus(MAX_ADVANCE))) {
            throw new ApiException(ErrorCode.RULE_VIOLATION, "Du kan ikke booke mer enn 180 dager frem i tid.");
        }

        // Membership is read from the database inside this transaction, never taken from the client.
        if (!memberships.existsById(new MembershipId(actor.getId(), request.organizationId()))) {
            throw new ApiException(
                    ErrorCode.NOT_MEMBER, "Du kan bare booke på vegne av organisasjoner du er medlem av.");
        }
        Organization organization = organizations.findById(request.organizationId())
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Organisasjonen finnes ikke."));
        Room room = rooms.findByIdForBooking(request.roomId())
                .filter(r -> r.getStatus() != RoomStatus.ARCHIVED)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Rommet finnes ikke."));

        Permission permission = roomService.effectivePermission(room, organization);
        if (permission == Permission.NONE) {
            throw new ApiException(
                    ErrorCode.NO_PERMISSION,
                    organization.getName() + " har ikke tilgang til å booke " + room.getName() + ".");
        }

        // Requests for an already confirmed slot are refused too, as in the prototype. The room
        // lock makes this check reliable; the exclusion constraint remains the final guarantee.
        if (bookings.existsApprovedOverlap(room.getId(), start, end)) {
            throw conflict(room);
        }

        Booking booking = new Booking(
                room.getId(),
                organization.getId(),
                actor.getId(),
                request.title().strip(),
                blankToNull(request.description()),
                start,
                end,
                permission == Permission.REQUEST,
                now);
        try {
            bookings.saveAndFlush(booking);
        } catch (DataIntegrityViolationException e) {
            if (isExclusionViolation(e)) {
                throw conflict(room);
            }
            throw e;
        }
        return toResponse(booking, actor);
    }

    /**
     * Approves a pending request. Access and availability may have changed since the request
     * was made, so membership, permission and conflicts are all checked again (SECURITY_AUDIT
     * VULN-04). Two admins approving overlapping requests at once is stopped by the exclusion
     * constraint; two admins approving the same request by the version check.
     */
    @Transactional
    public BookingResponse approve(User actor, UUID id, ApproveBookingRequest request) {
        requireAdmin(actor);
        Booking booking = findOrNotFound(id);
        requirePending(booking);
        requireVersion(booking, request.version());
        Instant now = clock.instant();
        if (!booking.getStartAt().isAfter(now)) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Tidspunktet har allerede passert og kan ikke godkjennes.");
        }

        if (!memberships.existsById(new MembershipId(booking.getRequestedById(), booking.getOrganizationId()))) {
            throw new ApiException(ErrorCode.NOT_MEMBER, "Søkeren er ikke lenger medlem av organisasjonen.");
        }
        Organization organization = organizations.getReferenceById(booking.getOrganizationId());
        Room room = rooms.findByIdForBooking(booking.getRoomId()).orElseThrow();
        if (roomService.effectivePermission(room, organization) == Permission.NONE) {
            throw new ApiException(
                    ErrorCode.NO_PERMISSION,
                    organization.getName() + " har ikke lenger tilgang til å booke " + room.getName() + ".");
        }
        if (bookings.existsOtherApprovedOverlap(room.getId(), booking.getStartAt(), booking.getEndAt(), booking.getId())) {
            throw conflict(room);
        }

        booking.approve(actor.getId(), now, blankToNull(request.comment()));
        flush(room);
        return toResponse(booking, actor);
    }

    @Transactional
    public BookingResponse reject(User actor, UUID id, RejectBookingRequest request) {
        requireAdmin(actor);
        Booking booking = findOrNotFound(id);
        requirePending(booking);
        requireVersion(booking, request.version());

        booking.reject(actor.getId(), clock.instant(), request.reason().strip());
        flush(null);
        return toResponse(booking, actor);
    }

    /**
     * Admins can cancel any booking, organization admins their organization's bookings, and
     * requesters their own while they are still members (SECURITY_AUDIT VULN-07).
     */
    @Transactional
    public BookingResponse cancel(User actor, UUID id, CancelBookingRequest request) {
        Set<UUID> myOrganizationIds = organizationIdsOf(actor);
        Booking booking = bookings.findById(id)
                .filter(b -> isVisible(b, actor, myOrganizationIds))
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Bookingen finnes ikke."));
        if (!mayCancel(actor, booking)) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Du har ikke lov til å kansellere denne bookingen.");
        }
        if (booking.getStatus() != BookingStatus.APPROVED && booking.getStatus() != BookingStatus.PENDING) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Bookingen er allerede avsluttet.");
        }
        requireVersion(booking, request.version());
        Instant now = clock.instant();
        if (!booking.getStartAt().isAfter(now)) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Bookinger som har startet kan ikke kanselleres.");
        }

        booking.cancel(actor.getId(), now, blankToNull(request.reason()));
        flush(null);
        return toResponse(booking, actor);
    }

    private boolean mayCancel(User actor, Booking booking) {
        if (actor.isSystemAdmin()) {
            return true;
        }
        return memberships.findById(new MembershipId(actor.getId(), booking.getOrganizationId()))
                .map(m -> m.getRole() == MembershipRole.ORG_ADMIN || booking.getRequestedById().equals(actor.getId()))
                .orElse(false);
    }

    private static void requireAdmin(User actor) {
        if (!actor.isSystemAdmin()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bare administratorer kan behandle søknader.");
        }
    }

    private Booking findOrNotFound(UUID id) {
        return bookings.findById(id)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Bookingen finnes ikke."));
    }

    private static void requirePending(Booking booking) {
        if (booking.getStatus() != BookingStatus.PENDING) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Søknaden er allerede behandlet.");
        }
    }

    private static void requireVersion(Booking booking, int expected) {
        if (booking.getVersion() != expected) {
            throw versionConflict();
        }
    }

    /**
     * Writes the change now, inside this method, so that a lost optimistic-locking race or an
     * exclusion-constraint violation becomes a domain error instead of failing at commit.
     */
    private void flush(Room room) {
        try {
            bookings.flush();
        } catch (OptimisticLockingFailureException e) {
            throw versionConflict();
        } catch (DataIntegrityViolationException e) {
            if (room != null && isExclusionViolation(e)) {
                throw conflict(room);
            }
            throw e;
        }
    }

    private static ApiException versionConflict() {
        return new ApiException(
                ErrorCode.VERSION_CONFLICT, "Bookingen er endret av noen andre. Last inn på nytt og prøv igjen.");
    }

    /** Approved bookings plus pending requests the actor may see, overlapping [from, to). */
    @Transactional(readOnly = true)
    public List<BookingResponse> list(User actor, Instant from, Instant to, UUID roomId) {
        if (!to.isAfter(from) || Duration.between(from, to).compareTo(MAX_QUERY_RANGE) > 0) {
            throw new ApiException(ErrorCode.VALIDATION, "Tidsrommet må være mellom 0 og 62 dager.");
        }
        List<Booking> found = roomId == null
                ? bookings.findInRange(CALENDAR_STATUSES, from, to)
                : bookings.findInRangeForRoom(roomId, CALENDAR_STATUSES, from, to);

        Set<UUID> myOrganizationIds = organizationIdsOf(actor);
        List<Booking> visible = found.stream()
                .filter(b -> isVisible(b, actor, myOrganizationIds))
                .toList();
        return toResponses(visible, actor, myOrganizationIds);
    }

    /** The actor's own bookings and requests, in every status, from the last 90 days onwards. */
    @Transactional(readOnly = true)
    public List<BookingResponse> mine(User actor) {
        Instant since = clock.instant().minus(MY_HISTORY);
        List<Booking> found = bookings.findByRequestedByIdAndEndAtAfterOrderByStartAt(actor.getId(), since);
        return toResponses(found, actor, organizationIdsOf(actor));
    }

    /** Admin queue: every pending request, plus the 50 most recently decided ones. */
    @Transactional(readOnly = true)
    public List<BookingResponse> requests(User actor) {
        requireAdmin(actor);
        List<Booking> found = Stream.concat(
                        bookings.findByStatusOrderByStartAt(BookingStatus.PENDING).stream(),
                        bookings.findTop50ByRequiresApprovalTrueAndDecidedAtNotNullOrderByDecidedAtDesc().stream())
                .toList();
        return toResponses(found, actor, Set.of());
    }

    /** Bookings the actor may not see are reported as not found, so their existence is not leaked. */
    @Transactional(readOnly = true)
    public BookingResponse get(User actor, UUID id) {
        Set<UUID> myOrganizationIds = organizationIdsOf(actor);
        Booking booking = bookings.findById(id)
                .filter(b -> isVisible(b, actor, myOrganizationIds))
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Bookingen finnes ikke."));
        return toResponses(List.of(booking), actor, myOrganizationIds).getFirst();
    }

    /** Everyone sees approved bookings; other statuses only for the own organization and admins. */
    private static boolean isVisible(Booking booking, User actor, Set<UUID> myOrganizationIds) {
        return booking.getStatus() == BookingStatus.APPROVED
                || actor.isSystemAdmin()
                || myOrganizationIds.contains(booking.getOrganizationId());
    }

    private Set<UUID> organizationIdsOf(User actor) {
        return memberships.findByIdUserId(actor.getId()).stream()
                .map(Membership::getId)
                .map(MembershipId::organizationId)
                .collect(Collectors.toSet());
    }

    private BookingResponse toResponse(Booking booking, User actor) {
        return toResponses(List.of(booking), actor, organizationIdsOf(actor)).getFirst();
    }

    /**
     * Maps bookings to responses, loading organization and user names in two queries.
     * Description, comments and the people involved are only included for the booking's own
     * organization and administrators.
     */
    private List<BookingResponse> toResponses(List<Booking> found, User actor, Set<UUID> myOrganizationIds) {
        Map<UUID, Organization> orgById = organizations
                .findAllById(found.stream().map(Booking::getOrganizationId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(Organization::getId, Function.identity()));

        Set<UUID> userIds = new HashSet<>();
        for (Booking b : found) {
            if (actor.isSystemAdmin() || myOrganizationIds.contains(b.getOrganizationId())) {
                userIds.add(b.getRequestedById());
                if (b.getDecidedById() != null) {
                    userIds.add(b.getDecidedById());
                }
            }
        }
        Map<UUID, String> nameById = users.findAllById(userIds).stream()
                .collect(Collectors.toMap(User::getId, User::getDisplayName));

        return found.stream()
                .map(b -> {
                    boolean own = actor.isSystemAdmin() || myOrganizationIds.contains(b.getOrganizationId());
                    Organization organization = orgById.get(b.getOrganizationId());
                    return new BookingResponse(
                            b.getId(),
                            b.getRoomId(),
                            b.getOrganizationId(),
                            organization == null ? null : organization.getName(),
                            own ? b.getRequestedById() : null,
                            own ? nameById.get(b.getRequestedById()) : null,
                            b.getTitle(),
                            own ? b.getDescription() : null,
                            b.getStartAt(),
                            b.getEndAt(),
                            b.getStatus(),
                            b.isRequiresApproval(),
                            own,
                            b.getCreatedAt(),
                            b.getDecidedAt(),
                            own && b.getDecidedById() != null ? nameById.get(b.getDecidedById()) : null,
                            own ? b.getDecisionComment() : null,
                            b.getCancelledAt(),
                            own ? b.getCancellationReason() : null,
                            b.getVersion());
                })
                .toList();
    }

    private static ApiException conflict(Room room) {
        return new ApiException(ErrorCode.CONFLICT, room.getName() + " er allerede booket i dette tidsrommet.");
    }

    private static boolean isExclusionViolation(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof SQLException sql && EXCLUSION_VIOLATION.equals(sql.getSQLState())) {
                return true;
            }
        }
        return false;
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}
