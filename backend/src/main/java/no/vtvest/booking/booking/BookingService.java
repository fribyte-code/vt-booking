package no.vtvest.booking.booking;

import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Collection;
import java.util.HashMap;
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
import no.vtvest.booking.room.OpeningHours;
import no.vtvest.booking.room.OpeningHoursRepository;
import no.vtvest.booking.room.Room;
import no.vtvest.booking.room.RoomManagement;
import no.vtvest.booking.room.RoomRepository;
import no.vtvest.booking.room.RoomService;
import no.vtvest.booking.room.RoomStatus;
import no.vtvest.booking.user.User;
import no.vtvest.booking.user.UserRepository;
import no.vtvest.booking.user.UserStatus;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Booking rules, enforced on every write: membership, room permission, time limits (no past
 * bookings, max 12 hours, max 180 days ahead, closed 05:00–07:00), conflicts, and the approval workflow. The
 * frontend mirrors them in bookingRules.ts for live feedback only. The database exclusion
 * constraint is the final guarantee against double booking under concurrency.
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
    private final ZoneId zone;
    private final OpeningHoursRepository openingHours;
    private final RoomManagement roomManagement;

    BookingService(
            BookingRepository bookings,
            RoomRepository rooms,
            RoomService roomService,
            OrganizationRepository organizations,
            MembershipRepository memberships,
            UserRepository users,
            Clock clock,
            ZoneId zone,
            OpeningHoursRepository openingHours,
            RoomManagement roomManagement) {
        this.bookings = bookings;
        this.rooms = rooms;
        this.roomService = roomService;
        this.organizations = organizations;
        this.memberships = memberships;
        this.users = users;
        this.clock = clock;
        this.zone = zone;
        this.openingHours = openingHours;
        this.roomManagement = roomManagement;
    }

    @Transactional
    public BookingResponse create(User actor, CreateBookingRequest request) {
        return create(actor, request, true);
    }

    /**
     * A system admin booking on behalf of any active organization, e.g. when turning a request from
     * the public form into a booking: membership and room access are not needed, and the booking is
     * approved directly, whatever the organization's access (which is not changed). Closed rooms,
     * times and conflicts are checked as in {@link #create}.
     */
    @Transactional
    public BookingResponse createOnBehalf(User actor, CreateBookingRequest request) {
        if (!actor.isSystemAdmin()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bare systemadministratorer har tilgang.");
        }
        return create(actor, request, false);
    }

    private BookingResponse create(User actor, CreateBookingRequest request, boolean requireMembership) {
        Instant start = request.start().toInstant();
        Instant end = request.end().toInstant();
        Instant now = clock.instant();
        validateTimes(start, end, now, zone);

        Organization organization = requireMembership
                ? requireMembership(actor, request.organizationId(), true)
                : organizations.findByIdForBooking(request.organizationId())
                        .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Organisasjonen finnes ikke."));
        Room room = lockBookableRoom(request.roomId());
        requireOpen(room, start, end);
        Permission permission = requireMembership ? requirePermission(room, organization) : permissionOnBehalf(room, organization);

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
                now,
                null);
        insert(List.of(booking), room);
        return toResponse(booking, actor);
    }

    /**
     * Edits a booking that has not started. A new title or description changes nothing else. A new
     * room or time is checked like a new booking: the organization's permission for the (new) room
     * decides the status, so a booking moved in a room that needs approval becomes a request again,
     * unless a system admin moves an approved booking. Editing one occurrence of a series affects
     * only that occurrence.
     */
    @Transactional
    public BookingResponse update(User actor, UUID id, UpdateBookingRequest request) {
        Viewer viewer = viewerOf(actor);
        Booking booking = bookings.findById(id)
                .filter(b -> viewer.sees(b))
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Bookingen finnes ikke."));
        Instant now = clock.instant();
        requireChangeable(actor, booking, request.version(), now, Change.EDIT);
        Instant start = request.start().toInstant();
        Instant end = request.end().toInstant();
        validateTimes(start, end, now, zone);
        String title = request.title().strip();
        String description = blankToNull(request.description());

        boolean moved = !request.roomId().equals(booking.getRoomId())
                || !start.equals(booking.getStartAt())
                || !end.equals(booking.getEndAt());
        if (!moved) {
            booking.editText(title, description, actor.getId(), now);
            flush(null);
            return toResponse(booking, actor);
        }

        // Same lock order as create: membership and organization (shared), then the rooms.
        Organization organization = lockForMove(booking.getRequestedById(), booking.getOrganizationId());
        Map<UUID, Room> locked = lockRooms(List.of(booking.getRoomId(), request.roomId()));
        requireMovableFrom(locked.get(booking.getRoomId()));
        Room room = requireMoveTarget(locked, request.roomId());
        requireOpen(room, start, end);
        Permission permission = requirePermission(room, organization);
        if (bookings.existsOtherApprovedOverlap(room.getId(), start, end, booking.getId())) {
            throw conflict(room);
        }

        booking.editText(title, description, actor.getId(), now);
        applyMove(booking, room, permission, start, end, actor, now);
        flush(room);
        return toResponse(booking, actor);
    }

    /**
     * Moves a booking to {@code room} and a new time, with the status the organization's
     * permission gives: DIRECT is approved at once; REQUEST becomes a new request, releasing the
     * slot until approved again, except when a system admin moves an approved booking. The caller
     * has checked the permission (not NONE) and conflicts.
     *
     * A booking can only become a request if its requester could still have it approved: approved
     * bookings are kept when the requester leaves the organization or is disabled, and moving such
     * a booking into a request would make it unapprovable and lose the slot.
     */
    void applyMove(Booking booking, Room room, Permission permission, Instant start, Instant end, User actor, Instant now) {
        if (permission == Permission.REQUEST && !(actor.isSystemAdmin() && booking.getStatus() == BookingStatus.APPROVED)) {
            switch (requesterState(booking)) {
                case NOT_MEMBER -> throw new ApiException(ErrorCode.INVALID_STATE,
                        "Den som booket, er ikke lenger medlem av organisasjonen, så bookingen kan ikke bli en søknad. "
                                + "Kanseller den og book på nytt i stedet.");
                case DISABLED -> throw new ApiException(ErrorCode.INVALID_STATE,
                        "Kontoen til den som booket, er deaktivert, så bookingen kan ikke bli en søknad. "
                                + "Kanseller den og book på nytt i stedet.");
                case OK -> {}
            }
        }
        if (permission == Permission.DIRECT) {
            booking.move(room.getId(), start, end, BookingStatus.APPROVED, false, false, actor.getId(), now);
        } else if (actor.isSystemAdmin() && booking.getStatus() == BookingStatus.APPROVED) {
            booking.move(room.getId(), start, end, BookingStatus.APPROVED, true, true, actor.getId(), now);
        } else {
            booking.move(room.getId(), start, end, BookingStatus.PENDING, true, false, actor.getId(), now);
        }
    }

    /**
     * Locks the rooms in a stable order (by id), so concurrent writes involving the same rooms
     * can't deadlock. Unknown ids are left out of the result.
     */
    Map<UUID, Room> lockRooms(Collection<UUID> roomIds) {
        Map<UUID, Room> locked = new HashMap<>();
        roomIds.stream().distinct().sorted()
                .forEach(id -> rooms.findByIdForBooking(id).ifPresent(r -> locked.put(id, r)));
        return locked;
    }

    /**
     * Share-locks what a move depends on, in the same order as {@link #create}: the requester's
     * membership (if any), then the organization. Removing the membership or archiving the
     * organization then waits for the move, and sees its result. Returns the organization.
     */
    Organization lockForMove(UUID requesterId, UUID organizationId) {
        memberships.findByIdForBooking(new MembershipId(requesterId, organizationId));
        return organizations.findByIdForBooking(organizationId).orElseThrow();
    }

    /** A booking can only be moved into an existing room that is not archived. */
    static Room requireMoveTarget(Map<UUID, Room> locked, UUID roomId) {
        Room room = locked.get(roomId);
        if (room == null || room.getStatus() == RoomStatus.ARCHIVED) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Rommet finnes ikke.");
        }
        return room;
    }

    /**
     * Bookings left in an archived room (kept when it was archived) can only get a new title or
     * description, or be cancelled; they can't be moved, not even to another room.
     */
    static void requireMovableFrom(Room currentRoom) {
        if (currentRoom != null && currentRoom.getStatus() == RoomStatus.ARCHIVED) {
            throw new ApiException(ErrorCode.INVALID_STATE,
                    "Rommet er arkivert. Bookingen kan bare få ny tittel eller beskrivelse, eller kanselleres.");
        }
    }

    // ── Rules shared by single bookings, edits and series ─────────

    /** Time rules for a new or moved booking, measured against the server clock. */
    static void validateTimes(Instant start, Instant end, Instant now, ZoneId zone) {
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
        ClosedHours.require(start, end, zone);
    }

    /**
     * The actor's membership and the organization, read from the database inside this transaction
     * and never taken from the client. With {@code lock} (for writes) both are share-locked, so
     * removing the membership or archiving the organization waits until this booking is written,
     * and then sees it.
     */
    Organization requireMembership(User actor, UUID organizationId, boolean lock) {
        MembershipId id = new MembershipId(actor.getId(), organizationId);
        if ((lock ? memberships.findByIdForBooking(id) : memberships.findById(id)).isEmpty()) {
            throw new ApiException(
                    ErrorCode.NOT_MEMBER, "Du kan bare booke på vegne av organisasjoner du er medlem av.");
        }
        return (lock ? organizations.findByIdForBooking(organizationId) : organizations.findById(organizationId))
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Organisasjonen finnes ikke."));
    }

    /** The room, locked for booking writes (see {@link RoomRepository#findByIdForBooking}). */
    Room lockBookableRoom(UUID roomId) {
        return rooms.findByIdForBooking(roomId)
                .filter(r -> r.getStatus() != RoomStatus.ARCHIVED)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Rommet finnes ikke."));
    }

    /**
     * The room's opening hours; none means always open. Writes hold the room row's lock, and
     * changing the hours updates that row, so they can't change under a booking being written.
     */
    List<OpeningHours.Interval> openingHoursOf(Room room) {
        return openingHours.forRoom(room.getId());
    }

    void requireOpen(Room room, Instant start, Instant end) {
        OpeningHours.require(room.getName(), openingHoursOf(room), start, end, zone);
    }

    /** As {@link #lockBookableRoom}, without the lock, for previews. */
    Room findBookableRoom(UUID roomId) {
        return rooms.findById(roomId)
                .filter(r -> r.getStatus() != RoomStatus.ARCHIVED)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Rommet finnes ikke."));
    }

    /** DIRECT or REQUEST; NONE is refused. */
    Permission requirePermission(Room room, Organization organization) {
        Permission permission = roomService.effectivePermission(room, organization);
        if (permission == Permission.NONE) {
            throw new ApiException(
                    ErrorCode.NO_PERMISSION,
                    organization.getName() + " har ikke tilgang til å booke " + room.getName() + ".");
        }
        return permission;
    }

    /** For {@link #createOnBehalf}: the admin's booking is the decision, so an open room is always DIRECT. */
    private Permission permissionOnBehalf(Room room, Organization organization) {
        if (room.getStatus() != RoomStatus.ACTIVE || !organization.isActive()) {
            return requirePermission(room, organization);
        }
        return Permission.DIRECT;
    }

    /** Inserts new bookings, turning an exclusion-constraint violation into CONFLICT. */
    void insert(List<Booking> created, Room room) {
        try {
            bookings.saveAllAndFlush(created);
        } catch (DataIntegrityViolationException e) {
            if (isExclusionViolation(e)) {
                throw conflict(room);
            }
            throw e;
        }
    }

    /**
     * Approves a pending request. Access and availability may have changed since the request
     * was made, so membership, permission and conflicts are all checked again. Two admins
     * approving overlapping requests at once is stopped by the exclusion constraint; two admins
     * approving the same request by the version check.
     */
    @Transactional
    public BookingResponse approve(User actor, UUID id, ApproveBookingRequest request) {
        Viewer viewer = viewerOf(actor);
        requireMayDecideAny(viewer);
        Booking booking = findOrNotFound(id);
        requireMayDecide(viewer, booking);
        requirePending(booking);
        requireVersion(booking, request.version());
        Instant now = clock.instant();
        if (!booking.getStartAt().isAfter(now)) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Tidspunktet har allerede passert og kan ikke godkjennes.");
        }

        requireRequesterMayStillBook(booking);
        Room room = rooms.findByIdForBooking(booking.getRoomId()).orElseThrow();
        ApiException problem = approvalProblem(booking, room);
        if (problem != null) {
            throw problem;
        }

        booking.approve(actor.getId(), now, blankToNull(request.comment()));
        flush(room);
        return toResponse(booking, actor);
    }

    /**
     * The requester must still be an active account and a member of the organization. Disabled
     * accounts' requests are cancelled when the account is disabled, but this also covers requests
     * made in a race with it.
     */
    void requireRequesterMayStillBook(Booking booking) {
        switch (requesterState(booking)) {
            case NOT_MEMBER -> throw new ApiException(ErrorCode.NOT_MEMBER, "Søkeren er ikke lenger medlem av organisasjonen.");
            case DISABLED -> throw new ApiException(
                    ErrorCode.INVALID_STATE, "Søkerens konto er deaktivert, så søknaden kan ikke godkjennes.");
            case OK -> {}
        }
    }

    private enum RequesterState { OK, NOT_MEMBER, DISABLED }

    /** Whether the booking's requester is still a member of its organization and an active account. */
    private RequesterState requesterState(Booking booking) {
        if (!memberships.existsById(new MembershipId(booking.getRequestedById(), booking.getOrganizationId()))) {
            return RequesterState.NOT_MEMBER;
        }
        if (users.findById(booking.getRequestedById()).map(u -> u.getStatus() != UserStatus.ACTIVE).orElse(true)) {
            return RequesterState.DISABLED;
        }
        return RequesterState.OK;
    }

    /**
     * Why a pending request in the (locked) room can't be approved now, or null: the organization
     * lost its permission, or the slot was taken.
     */
    ApiException approvalProblem(Booking booking, Room room) {
        Organization organization = organizations.getReferenceById(booking.getOrganizationId());
        if (roomService.effectivePermission(room, organization) == Permission.NONE) {
            return new ApiException(
                    ErrorCode.NO_PERMISSION,
                    organization.getName() + " har ikke lenger tilgang til å booke " + room.getName() + ".");
        }
        List<OpeningHours.Interval> hours = openingHoursOf(room);
        if (!OpeningHours.allows(hours, booking.getStartAt(), booking.getEndAt(), zone)) {
            return new ApiException(ErrorCode.RULE_VIOLATION,
                    room.getName() + " er bare åpent " + OpeningHours.describe(hours) + ". Flytt søknaden før den godkjennes.");
        }
        if (bookings.existsOtherApprovedOverlap(room.getId(), booking.getStartAt(), booking.getEndAt(), booking.getId())) {
            return conflict(room);
        }
        return null;
    }

    @Transactional
    public BookingResponse reject(User actor, UUID id, RejectBookingRequest request) {
        Viewer viewer = viewerOf(actor);
        requireMayDecideAny(viewer);
        Booking booking = findOrNotFound(id);
        requireMayDecide(viewer, booking);
        requirePending(booking);
        requireVersion(booking, request.version());

        booking.reject(actor.getId(), clock.instant(), request.reason().strip());
        flush(null);
        return toResponse(booking, actor);
    }

    /**
     * Admins can cancel any booking, organization admins their organization's bookings, and
     * requesters their own while they are still members ({@link #mayChange}).
     */
    @Transactional
    public BookingResponse cancel(User actor, UUID id, CancelBookingRequest request) {
        Viewer viewer = viewerOf(actor);
        Booking booking = bookings.findById(id)
                .filter(b -> viewer.sees(b))
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Bookingen finnes ikke."));
        Instant now = clock.instant();
        requireChangeable(actor, booking, request.version(), now, Change.CANCEL);

        booking.cancel(actor.getId(), now, blankToNull(request.reason()));
        flush(null);
        return toResponse(booking, actor);
    }

    /** Edit or cancel, of one booking or of several in a series, with the messages for each. */
    enum Change {
        EDIT("Du har ikke lov til å endre denne bookingen.",
                "Bookingen er avsluttet og kan ikke endres.",
                "Bookinger og søknader som har startet, kan ikke endres."),
        CANCEL("Du har ikke lov til å kansellere denne bookingen.",
                "Bookingen er allerede avsluttet.",
                "Bookinger som har startet kan ikke kanselleres."),
        EDIT_SERIES("Du har ikke lov til å endre alle disse bookingene i serien.", EDIT.closed, EDIT.started),
        CANCEL_SERIES("Du har ikke lov til å kansellere alle disse bookingene i serien.", CANCEL.closed, CANCEL.started);

        private final String forbidden;
        private final String closed;
        private final String started;

        Change(String forbidden, String closed, String started) {
            this.forbidden = forbidden;
            this.closed = closed;
            this.started = started;
        }
    }

    /**
     * The one set of rules for editing or cancelling a booking, in this order: the actor may change
     * it ({@link #mayChange}), it is APPROVED or PENDING, the version matches (unless null, for
     * series operations), and it has not started.
     */
    void requireChangeable(User actor, Booking booking, Integer version, Instant now, Change change) {
        if (!mayChange(actor, booking)) {
            throw new ApiException(ErrorCode.FORBIDDEN, change.forbidden);
        }
        if (!isOpen(booking)) {
            throw new ApiException(ErrorCode.INVALID_STATE, change.closed);
        }
        if (version != null) {
            requireVersion(booking, version);
        }
        if (!booking.getStartAt().isAfter(now)) {
            throw new ApiException(ErrorCode.INVALID_STATE, change.started);
        }
    }

    /** APPROVED or PENDING, and not started: what a series edit or cancellation acts on. */
    static boolean isOpenAndUpcoming(Booking booking, Instant now) {
        return isOpen(booking) && booking.getStartAt().isAfter(now);
    }

    private static boolean isOpen(Booking booking) {
        return booking.getStatus() == BookingStatus.APPROVED || booking.getStatus() == BookingStatus.PENDING;
    }

    /**
     * Who may cancel or edit a booking: system admins, the requester while still a member of the
     * booking's organization, and the organization's ORG_ADMINs while the organization is active.
     */
    boolean mayChange(User actor, Booking booking) {
        if (actor.isSystemAdmin()) {
            return true;
        }
        Membership membership = memberships.findById(new MembershipId(actor.getId(), booking.getOrganizationId()))
                .orElse(null);
        if (membership == null) {
            return false;
        }
        if (booking.getRequestedById().equals(actor.getId())) {
            return true;
        }
        return membership.getRole() == MembershipRole.ORG_ADMIN
                && organizations.findById(booking.getOrganizationId()).map(Organization::isActive).orElse(false);
    }

    /** System admins and room managers may handle requests; anyone else gets 403 before any lookup. */
    static void requireMayDecideAny(Viewer viewer) {
        if (!viewer.mayDecideAny()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bare administratorer og romansvarlige kan behandle søknader.");
        }
    }

    /** Approving and rejecting a request in a room: system admins, and the managers of that room. */
    static void requireMayDecide(Viewer viewer, Booking booking) {
        if (!viewer.mayDecide(booking.getRoomId())) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Du kan bare behandle søknader for rom du er romansvarlig for.");
        }
    }

    static void requireAdmin(User actor) {
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

    static void requireVersion(Booking booking, int expected) {
        if (booking.getVersion() != expected) {
            throw versionConflict();
        }
    }

    /**
     * Writes the change now, inside this method, so that a lost optimistic-locking race or an
     * exclusion-constraint violation becomes a domain error instead of failing at commit.
     */
    void flush(Room room) {
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

    /** Approved bookings plus unexpired pending requests the actor may see, overlapping [from, to). */
    @Transactional(readOnly = true)
    public List<BookingResponse> list(User actor, Instant from, Instant to, UUID roomId) {
        if (!to.isAfter(from) || Duration.between(from, to).compareTo(MAX_QUERY_RANGE) > 0) {
            throw new ApiException(ErrorCode.VALIDATION, "Tidsrommet må være mellom 0 og 62 dager.");
        }
        List<Booking> found = roomId == null
                ? bookings.findInRange(CALENDAR_STATUSES, from, to)
                : bookings.findInRangeForRoom(roomId, CALENDAR_STATUSES, from, to);

        Viewer viewer = viewerOf(actor);
        Instant now = clock.instant();
        List<Booking> visible = found.stream()
                .filter(b -> !isExpiredRequest(b, now))
                .filter(b -> viewer.sees(b))
                .toList();
        return toResponses(visible, viewer);
    }

    /** The actor's own bookings and requests, in every status, from the last 90 days onwards. */
    @Transactional(readOnly = true)
    public List<BookingResponse> mine(User actor) {
        Instant since = clock.instant().minus(MY_HISTORY);
        List<Booking> found = bookings.findByRequestedByIdAndEndAtAfterOrderByStartAt(actor.getId(), since);
        return toResponses(found, viewerOf(actor));
    }

    /**
     * The approval queue: pending requests that have not started, plus the 50 most recently decided
     * ones. System admins get every room's; room managers only their rooms', selected in the query.
     * A request whose start has passed can no longer be approved, so it has expired: it stays
     * PENDING in the database, but leaves the queue and the calendar. "My bookings" still shows it.
     */
    @Transactional(readOnly = true)
    public List<BookingResponse> requests(User actor) {
        Viewer viewer = viewerOf(actor);
        requireMayDecideAny(viewer);
        Instant now = clock.instant();
        Stream<Booking> pending;
        Stream<Booking> decided;
        if (viewer.isSystemAdmin()) {
            pending = bookings.findByStatusAndStartAtAfterOrderByStartAt(BookingStatus.PENDING, now).stream();
            decided = bookings.findTop50ByRequiresApprovalTrueAndDecidedAtNotNullOrderByDecidedAtDesc().stream();
        } else {
            pending = bookings.findByStatusAndRoomIdInAndStartAtAfterOrderByStartAt(
                    BookingStatus.PENDING, viewer.managedRoomIds(), now).stream();
            decided = bookings.findTop50ByRoomIdInAndRequiresApprovalTrueAndDecidedAtNotNullOrderByDecidedAtDesc(
                    viewer.managedRoomIds()).stream();
        }
        return toResponses(Stream.concat(pending, decided).toList(), viewer);
    }

    /** Bookings the actor may not see are reported as not found, so their existence is not leaked. */
    @Transactional(readOnly = true)
    public BookingResponse get(User actor, UUID id) {
        Viewer viewer = viewerOf(actor);
        Booking booking = bookings.findById(id)
                .filter(b -> viewer.sees(b))
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Bookingen finnes ikke."));
        return toResponses(List.of(booking), viewer).getFirst();
    }

    // ── Future bookings of deactivated rooms, organizations and users ──

    /** Whose future bookings: a room's, an organization's, or those a user requested. */
    public enum Scope { ROOM, ORGANIZATION, REQUESTER }

    /** System admin only: future APPROVED and PENDING bookings, to preview what a deactivation cancels. */
    @Transactional(readOnly = true)
    public List<BookingResponse> futureBookings(User actor, Scope scope, UUID id) {
        requireAdmin(actor);
        Instant now = clock.instant();
        List<Booking> found = switch (scope) {
            case ROOM -> bookings.findFutureInRoom(id, CALENDAR_STATUSES, now);
            case ORGANIZATION -> bookings.findFutureForOrganization(id, CALENDAR_STATUSES, now);
            case REQUESTER -> bookings.findFutureByRequester(id, CALENDAR_STATUSES, now);
        };
        return toResponses(found, viewerOf(actor));
    }

    /**
     * Cancels future APPROVED and PENDING bookings in bulk, recording the acting admin and a system
     * reason. Called by the admin and member services in their own transaction, after the change
     * that makes the bookings invalid (which holds the room, organization or membership row lock).
     * The bookings are locked in id order like every multi-row write. Returns how many were cancelled.
     */
    @Transactional
    public int cancelFuture(User actor, Scope scope, UUID id, boolean includeApproved, String reason) {
        List<BookingStatus> statuses = includeApproved ? CALENDAR_STATUSES : List.of(BookingStatus.PENDING);
        Instant now = clock.instant();
        List<Booking> found = switch (scope) {
            case ROOM -> bookings.lockFutureInRoom(id, statuses, now);
            case ORGANIZATION -> bookings.lockFutureForOrganization(id, statuses, now);
            case REQUESTER -> bookings.lockFutureByRequester(id, statuses, now);
        };
        return cancelAll(found, actor, now, reason);
    }

    /** A removed member's future pending requests for that organization. Approved bookings belong to the organization and are kept. */
    @Transactional
    public int cancelFutureRequestsOfFormerMember(User actor, UUID userId, UUID organizationId) {
        Instant now = clock.instant();
        List<Booking> found = bookings.lockFutureByRequesterInOrganization(
                userId, organizationId, List.of(BookingStatus.PENDING), now);
        return cancelAll(found, actor, now, "Brukeren er ikke lenger medlem av organisasjonen.");
    }

    private int cancelAll(List<Booking> found, User actor, Instant now, String reason) {
        found.forEach(b -> b.cancel(actor.getId(), now, reason));
        flush(null);
        return found.size();
    }

    /** A pending request whose start has passed: it can no longer be approved or withdrawn. */
    private static boolean isExpiredRequest(Booking booking, Instant now) {
        return booking.getStatus() == BookingStatus.PENDING && !booking.getStartAt().isAfter(now);
    }

    /** The actor's organizations and managed rooms, read from the database for this request. */
    Viewer viewerOf(User actor) {
        Set<UUID> organizationIds = memberships.findByIdUserId(actor.getId()).stream()
                .map(Membership::getId)
                .map(MembershipId::organizationId)
                .collect(Collectors.toSet());
        return new Viewer(actor, organizationIds, roomManagement.managedRoomIds(actor.getId()));
    }

    BookingResponse toResponse(Booking booking, User actor) {
        return toResponses(List.of(booking), viewerOf(actor)).getFirst();
    }

    /**
     * Maps bookings to responses, loading room, organization and user names in three queries.
     * Description, comments and the people involved are only included for the booking's own
     * organization, the room's managers and system admins.
     */
    List<BookingResponse> toResponses(List<Booking> found, Viewer viewer) {
        Map<UUID, Organization> orgById = organizations
                .findAllById(found.stream().map(Booking::getOrganizationId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(Organization::getId, Function.identity()));

        Map<UUID, String> roomNameById = rooms
                .findAllById(found.stream().map(Booking::getRoomId).distinct().toList())
                .stream()
                .collect(Collectors.toMap(Room::getId, Room::getName));

        Set<UUID> userIds = new HashSet<>();
        for (Booking b : found) {
            if (viewer.seesDetails(b)) {
                userIds.add(b.getRequestedById());
                if (b.getDecidedById() != null) {
                    userIds.add(b.getDecidedById());
                }
                if (b.getCancelledById() != null) {
                    userIds.add(b.getCancelledById());
                }
                if (b.getUpdatedById() != null) {
                    userIds.add(b.getUpdatedById());
                }
            }
        }
        Map<UUID, String> nameById = users.findAllById(userIds).stream()
                .collect(Collectors.toMap(User::getId, User::getDisplayName));

        return found.stream()
                .map(b -> {
                    boolean own = viewer.seesDetails(b);
                    Organization organization = orgById.get(b.getOrganizationId());
                    return new BookingResponse(
                            b.getId(),
                            b.getRoomId(),
                            roomNameById.get(b.getRoomId()),
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
                            viewer.ownOrganization(b),
                            viewer.mayDecide(b.getRoomId()),
                            b.getCreatedAt(),
                            b.getDecidedAt(),
                            own && b.getDecidedById() != null ? nameById.get(b.getDecidedById()) : null,
                            own ? b.getDecisionComment() : null,
                            b.getCancelledAt(),
                            own ? b.getCancelledById() : null,
                            own && b.getCancelledById() != null ? nameById.get(b.getCancelledById()) : null,
                            own ? b.getCancellationReason() : null,
                            b.getUpdatedAt(),
                            own && b.getUpdatedById() != null ? nameById.get(b.getUpdatedById()) : null,
                            b.getSeriesId(),
                            b.getVersion());
                })
                .toList();
    }

    static ApiException conflict(Room room) {
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

    static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }
}
