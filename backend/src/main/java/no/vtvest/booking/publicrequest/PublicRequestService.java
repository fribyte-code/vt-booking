package no.vtvest.booking.publicrequest;

import static no.vtvest.booking.publicrequest.PublicRequestDtos.*;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import no.vtvest.booking.booking.BookingResponse;
import no.vtvest.booking.booking.BookingService;
import no.vtvest.booking.booking.CreateBookingRequest;
import no.vtvest.booking.booking.ClosedHours;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.room.OpeningHours;
import no.vtvest.booking.room.OpeningHoursRepository;
import no.vtvest.booking.user.AccountService;
import no.vtvest.booking.user.User;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Requests from the public form. Anyone can send one; only a system admin can read, reject or
 * turn one into a booking. The booking goes through {@link BookingService} with all its rules.
 */
@Service
class PublicRequestService {

    /**
     * 07:00 to 05:00 the next day, the longest the closed hours (05:00–07:00) leave. The admin
     * adjusts the time when making the booking, where the booking rules (max 12 hours) apply.
     */
    static final Duration MAX_DURATION = Duration.ofHours(22);
    private static final Pattern CARD_NUMBER = Pattern.compile("^[0-9]{4,20}$");
    private static final Pattern PHONE = Pattern.compile("^\\+?[0-9]{8,15}$");
    /** As far ahead as a booking can be made (BookingService.MAX_ADVANCE). */
    static final Duration MAX_ADVANCE = Duration.ofDays(180);

    private final JdbcTemplate jdbc;
    private final BookingService bookingService;
    private final Clock clock;
    private final ZoneId zone;
    private final OpeningHoursRepository openingHours;

    PublicRequestService(
            JdbcTemplate jdbc, BookingService bookingService, Clock clock, ZoneId zone, OpeningHoursRepository openingHours) {
        this.jdbc = jdbc;
        this.bookingService = bookingService;
        this.clock = clock;
        this.zone = zone;
        this.openingHours = openingHours;
    }

    @Transactional
    void submit(SubmitPublicRequest body) {
        Instant start = body.start().toInstant();
        Instant end = body.end().toInstant();
        validateTimes(start, end);
        if (!start.isAfter(clock.instant())) {
            throw new ApiException(ErrorCode.VALIDATION, "Tidspunktet har allerede vært.");
        }
        if (start.isAfter(clock.instant().plus(MAX_ADVANCE))) {
            throw new ApiException(ErrorCode.VALIDATION, "Du kan søke om lån inntil 180 dager frem i tid.");
        }
        String roomName = requestableRoomName(body.preferredRoomId(), start, end);
        List<Contact> contacts = body.contacts().stream().map(PublicRequestService::normalize).toList();

        UUID id = jdbc.queryForObject("""
                INSERT INTO public_requests (email, organization_name, event_name, member_of_kulturstyret_or_samfunnet,
                    preferred_room_id, preferred_room_name, start_at, end_at, description, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
                """,
                UUID.class,
                AccountService.normalizeEmail(body.email()),
                body.organizationName().strip(),
                body.eventName().strip(),
                body.memberOfKulturstyretOrSamfunnet(),
                body.preferredRoomId(),
                roomName,
                Timestamp.from(start),
                Timestamp.from(end),
                body.description().strip(),
                Timestamp.from(clock.instant()));
        insertContacts(id, contacts);
    }

    /** End after start, at most 22 hours, and not overlapping 05:00–07:00: for the form and for edits. */
    private void validateTimes(Instant start, Instant end) {
        if (!end.isAfter(start)) {
            throw new ApiException(ErrorCode.VALIDATION, "Sluttidspunktet må være etter starttidspunktet.");
        }
        if (Duration.between(start, end).compareTo(MAX_DURATION) > 0) {
            throw new ApiException(ErrorCode.VALIDATION, "Arrangementet kan vare i høyst 22 timer.");
        }
        ClosedHours.require(start, end, zone);
    }

    private void insertContacts(UUID requestId, List<Contact> contacts) {
        for (int i = 0; i < contacts.size(); i++) {
            Contact c = contacts.get(i);
            jdbc.update("""
                    INSERT INTO public_request_contacts (request_id, position, name, organization, card_number, phone)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, requestId, i, c.name(), c.organization(), c.cardNumber(), c.phone());
        }
    }

    /**
     * A system admin corrects a request, at any status (also after it is handled). The same rules
     * as the form apply, except that the time may have passed and any room that isn't archived can
     * be chosen; opening hours are left to the booking. A booking made from it is not changed.
     */
    @Transactional
    PublicRequest update(User actor, UUID id, EditPublicRequest body) {
        requireSystemAdmin(actor);
        lock(id);
        Instant start = body.start().toInstant();
        Instant end = body.end().toInstant();
        validateTimes(start, end);
        String roomName = body.preferredRoomId() == null ? null : jdbc.query(
                        "SELECT name FROM rooms WHERE id = ? AND status <> 'ARCHIVED'", (rs, i) -> rs.getString("name"),
                        body.preferredRoomId())
                .stream().findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.VALIDATION, "Rommet finnes ikke."));
        List<Contact> contacts = body.contacts().stream().map(PublicRequestService::normalize).toList();

        jdbc.update("""
                UPDATE public_requests SET email = ?, organization_name = ?, event_name = ?,
                    member_of_kulturstyret_or_samfunnet = ?, preferred_room_id = ?, preferred_room_name = ?,
                    start_at = ?, end_at = ?, description = ?, updated_at = ?, updated_by_id = ?
                WHERE id = ?
                """,
                AccountService.normalizeEmail(body.email()),
                body.organizationName().strip(),
                body.eventName().strip(),
                body.memberOfKulturstyretOrSamfunnet(),
                body.preferredRoomId(),
                roomName,
                Timestamp.from(start),
                Timestamp.from(end),
                body.description().strip(),
                Timestamp.from(clock.instant()),
                actor.getId(),
                id);
        jdbc.update("DELETE FROM public_request_contacts WHERE request_id = ?", id);
        insertContacts(id, contacts);
        return find(id);
    }

    /** A system admin sets the handling status, to any of the four, e.g. "under arbeid" or "ferdig" outside the system. */
    @Transactional
    PublicRequest setStatus(User actor, UUID id, Status status) {
        requireSystemAdmin(actor);
        lock(id);
        jdbc.update("UPDATE public_requests SET status = ?, updated_at = ?, updated_by_id = ? WHERE id = ?",
                status.name(), Timestamp.from(clock.instant()), actor.getId(), id);
        return find(id);
    }

    /**
     * The rooms the public form offers: active and marked as requestable. Names, descriptions,
     * capacity and opening hours only; nothing about bookings, so availability isn't exposed.
     */
    @Transactional(readOnly = true)
    List<PublicRoom> rooms() {
        Map<UUID, List<OpeningHours.Interval>> hours = openingHours.all();
        return jdbc.query("""
                SELECT id, name, description, capacity FROM rooms
                WHERE status = 'ACTIVE' AND public_requestable ORDER BY lower(name)
                """, (rs, i) -> {
                    UUID id = rs.getObject("id", UUID.class);
                    return new PublicRoom(id, rs.getString("name"), rs.getString("description"),
                            (Integer) rs.getObject("capacity"), OpeningHours.toEntries(hours.getOrDefault(id, List.of())));
                });
    }

    /**
     * The name of the room asked for, which must be offered in the form, with the time within its
     * opening hours; null for no preference.
     */
    private String requestableRoomName(UUID roomId, Instant start, Instant end) {
        if (roomId == null) {
            return null;
        }
        String name = jdbc.query(
                        "SELECT name FROM rooms WHERE id = ? AND status = 'ACTIVE' AND public_requestable",
                        (rs, i) -> rs.getString("name"), roomId)
                .stream().findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.VALIDATION, "Rommet kan ikke forespørres. Velg et annet."));
        OpeningHours.require(name, openingHours.forRoom(roomId), start, end, zone);
        return name;
    }

    private static Contact normalize(Contact c) {
        String card = c.cardNumber().replaceAll("[\\s-]", "");
        String phone = c.phone().replaceAll("[\\s-]", "");
        if (!CARD_NUMBER.matcher(card).matches()) {
            throw new ApiException(ErrorCode.VALIDATION, "Kortnummeret skal bare ha sifre (4–20). Bruk kortnummeret, ikke studentnummeret.");
        }
        if (!PHONE.matcher(phone).matches()) {
            throw new ApiException(ErrorCode.VALIDATION, "Telefonnummeret må ha 8–15 sifre, eventuelt med + foran.");
        }
        return new Contact(c.name().strip(), c.organization().strip(), card, phone);
    }

    /** Newest first. */
    @Transactional(readOnly = true)
    List<PublicRequest> list(User actor) {
        requireSystemAdmin(actor);
        Map<UUID, List<Contact>> contacts = contactsByRequest("SELECT * FROM public_request_contacts ORDER BY position");
        return jdbc.query(REQUESTS + " ORDER BY p.created_at DESC", (rs, i) -> toRequest(rs, contacts));
    }

    /** How many requests nobody has started on (NEW), for the admin's badge. */
    @Transactional(readOnly = true)
    long countNew(User actor) {
        requireSystemAdmin(actor);
        Long count = jdbc.queryForObject("SELECT count(*) FROM public_requests WHERE status = 'NEW'", Long.class);
        return count == null ? 0 : count;
    }

    /** Rejects an open (NEW or IN_PROGRESS) request. */
    @Transactional
    PublicRequest reject(User actor, UUID id) {
        requireSystemAdmin(actor);
        lockOpen(id);
        return setStatus(actor, id, Status.REJECTED);
    }

    /**
     * Creates the booking and marks the request DONE with the booking, in one transaction: if the
     * booking is refused (conflict, missing access, invalid time), the request is left as it was.
     * Only an open request without a booking; one reopened after its booking was made keeps that.
     */
    @Transactional
    BookingResponse createBooking(User actor, UUID id, CreateBookingRequest booking) {
        requireSystemAdmin(actor);
        if (lockOpen(id) != null) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Forespørselen har allerede en booking.");
        }
        BookingResponse created = bookingService.createOnBehalf(actor, booking);
        jdbc.update("UPDATE public_requests SET status = 'DONE', booking_id = ?, updated_at = ?, updated_by_id = ? WHERE id = ?",
                created.id(), Timestamp.from(clock.instant()), actor.getId(), id);
        return created;
    }

    private static void requireSystemAdmin(User actor) {
        if (!actor.isSystemAdmin()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bare systemadministratorer har tilgang.");
        }
    }

    /** Locks the request, so two admins can't change it at the same time. Returns its status. */
    private String lock(UUID id) {
        return jdbc.query("SELECT status FROM public_requests WHERE id = ? FOR UPDATE", (rs, i) -> rs.getString("status"), id)
                .stream().findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Forespørselen finnes ikke."));
    }

    /** Locks the request and requires it to be open (NEW or IN_PROGRESS). Returns its booking id, or null. */
    private UUID lockOpen(UUID id) {
        String status = lock(id);
        if (!Status.NEW.name().equals(status) && !Status.IN_PROGRESS.name().equals(status)) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Forespørselen er allerede behandlet.");
        }
        return jdbc.queryForObject("SELECT booking_id FROM public_requests WHERE id = ?", UUID.class, id);
    }

    private PublicRequest find(UUID id) {
        Map<UUID, List<Contact>> contacts =
                contactsByRequest("SELECT * FROM public_request_contacts WHERE request_id = ? ORDER BY position", id);
        return jdbc.queryForObject(REQUESTS + " WHERE p.id = ?", (rs, i) -> toRequest(rs, contacts), id);
    }

    /** With the room's current name, or the name it had when asked for if it has been deleted. */
    private static final String REQUESTS = """
            SELECT p.*, coalesce(r.name, p.preferred_room_name) AS room_name, u.display_name AS updated_by_name
            FROM public_requests p LEFT JOIN rooms r ON r.id = p.preferred_room_id LEFT JOIN users u ON u.id = p.updated_by_id
            """;

    private Map<UUID, List<Contact>> contactsByRequest(String sql, Object... args) {
        return jdbc.query(sql, (rs, i) -> Map.entry(rs.getObject("request_id", UUID.class), new Contact(
                        rs.getString("name"), rs.getString("organization"), rs.getString("card_number"), rs.getString("phone"))),
                        args)
                .stream()
                .collect(Collectors.groupingBy(Map.Entry::getKey, Collectors.mapping(Map.Entry::getValue, Collectors.toList())));
    }

    private static PublicRequest toRequest(ResultSet rs, Map<UUID, List<Contact>> contacts) throws SQLException {
        UUID id = rs.getObject("id", UUID.class);
        return new PublicRequest(
                id,
                rs.getString("email"),
                rs.getString("organization_name"),
                rs.getString("event_name"),
                rs.getBoolean("member_of_kulturstyret_or_samfunnet"),
                rs.getObject("preferred_room_id", UUID.class),
                rs.getString("room_name"),
                rs.getTimestamp("start_at").toInstant(),
                rs.getTimestamp("end_at").toInstant(),
                rs.getString("description"),
                new ArrayList<>(contacts.getOrDefault(id, List.of())),
                Status.valueOf(rs.getString("status")),
                rs.getTimestamp("created_at").toInstant(),
                rs.getObject("booking_id", UUID.class),
                rs.getTimestamp("updated_at") == null ? null : rs.getTimestamp("updated_at").toInstant(),
                rs.getString("updated_by_name"));
    }
}
