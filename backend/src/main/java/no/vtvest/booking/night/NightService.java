package no.vtvest.booking.night;

import static no.vtvest.booking.night.NightDtos.*;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.user.User;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Natt, for system admins: every coming event that goes past midnight in local time
 * ({@code booking.time-zone}), in every room: approved bookings (series included), pending
 * applications that haven't expired, and public requests that aren't rejected and have no booking
 * yet (one with a booking is the booking). Guards are needed past midnight; the admin ticks off
 * that they are ordered ({@code guard_orders}).
 */
@Service
class NightService {

    /** As far ahead as anything can be booked. */
    static final Duration AHEAD = Duration.ofDays(181);

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final ZoneId zone;

    NightService(JdbcTemplate jdbc, Clock clock, ZoneId zone) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.zone = zone;
    }

    /** Past midnight: the last moment is on a later local day than the start (ending at 24:00 is not). */
    private static final String PAST_MIDNIGHT = """
            (%1$s.start_at AT TIME ZONE ?::text)::date <> ((%1$s.end_at - interval '1 microsecond') AT TIME ZONE ?::text)::date
            """;

    @Transactional(readOnly = true)
    List<NightEvent> list(User actor) {
        requireSystemAdmin(actor);
        Instant now = clock.instant();
        Timestamp from = Timestamp.from(now);
        Timestamp until = Timestamp.from(now.plus(AHEAD));
        String tz = zone.getId();
        Map<UUID, List<Contact>> contacts = jdbc.query(
                        "SELECT request_id, name, organization, phone FROM public_request_contacts ORDER BY position",
                        (rs, i) -> Map.entry(rs.getObject("request_id", UUID.class),
                                new Contact(rs.getString("name"), rs.getString("organization"), rs.getString("phone"))))
                .stream()
                .collect(Collectors.groupingBy(Map.Entry::getKey, Collectors.mapping(Map.Entry::getValue, Collectors.toList())));

        List<NightEvent> events = new ArrayList<>(jdbc.query("""
                SELECT b.id, b.series_id, b.title, b.start_at, b.end_at, b.status, b.room_id, r.name AS room_name,
                    o.name AS organization_name, u.display_name AS requester_name, p.id AS request_id,
                    g.ordered_at, gu.display_name AS ordered_by_name
                FROM bookings b
                JOIN rooms r ON r.id = b.room_id
                JOIN organizations o ON o.id = b.organization_id
                JOIN users u ON u.id = b.requested_by_id
                LEFT JOIN public_requests p ON p.booking_id = b.id
                LEFT JOIN guard_orders g ON (p.id IS NOT NULL AND g.public_request_id = p.id) OR (p.id IS NULL AND g.booking_id = b.id)
                LEFT JOIN users gu ON gu.id = g.ordered_by_id
                WHERE (b.status = 'APPROVED' OR (b.status = 'PENDING' AND b.start_at > ?))
                    AND b.end_at > ? AND b.start_at < ? AND
                """ + PAST_MIDNIGHT.formatted("b"),
                (rs, i) -> {
                    UUID requestId = rs.getObject("request_id", UUID.class);
                    return new NightEvent(
                            "PENDING".equals(rs.getString("status")) ? Kind.REQUEST : Kind.BOOKING,
                            rs.getObject("id", UUID.class),
                            requestId,
                            rs.getObject("series_id", UUID.class),
                            rs.getString("title"),
                            rs.getObject("room_id", UUID.class),
                            rs.getString("room_name"),
                            rs.getString("organization_name"),
                            rs.getTimestamp("start_at").toInstant(),
                            rs.getTimestamp("end_at").toInstant(),
                            requestId != null && contacts.containsKey(requestId)
                                    ? contacts.get(requestId)
                                    : List.of(new Contact(rs.getString("requester_name"), rs.getString("organization_name"), null)),
                            instant(rs.getTimestamp("ordered_at")),
                            rs.getString("ordered_by_name"));
                },
                from, from, until, tz, tz));

        events.addAll(jdbc.query("""
                SELECT p.id, p.event_name, p.start_at, p.end_at, p.preferred_room_id,
                    coalesce(r.name, p.preferred_room_name) AS room_name, p.organization_name, p.email,
                    g.ordered_at, gu.display_name AS ordered_by_name
                FROM public_requests p
                LEFT JOIN rooms r ON r.id = p.preferred_room_id
                LEFT JOIN guard_orders g ON g.public_request_id = p.id
                LEFT JOIN users gu ON gu.id = g.ordered_by_id
                WHERE p.status <> 'REJECTED' AND p.booking_id IS NULL AND p.end_at > ? AND p.start_at < ? AND
                """ + PAST_MIDNIGHT.formatted("p"),
                (rs, i) -> {
                    UUID id = rs.getObject("id", UUID.class);
                    return new NightEvent(
                            Kind.PUBLIC_REQUEST,
                            null,
                            id,
                            null,
                            rs.getString("event_name"),
                            rs.getObject("preferred_room_id", UUID.class),
                            rs.getString("room_name"),
                            rs.getString("organization_name"),
                            rs.getTimestamp("start_at").toInstant(),
                            rs.getTimestamp("end_at").toInstant(),
                            contacts.getOrDefault(id, List.of(new Contact(rs.getString("email"), rs.getString("organization_name"), null))),
                            instant(rs.getTimestamp("ordered_at")),
                            rs.getString("ordered_by_name"));
                },
                from, until, tz, tz));

        events.sort(Comparator.comparing(NightEvent::start).thenComparing(NightEvent::title));
        return events;
    }

    /** Coming events past midnight without guards ordered, for the tab's badge. */
    @Transactional(readOnly = true)
    long countWithoutGuards(User actor) {
        return list(actor).stream().filter(e -> e.guardsOrderedAt() == null).count();
    }

    /**
     * Ticks guards off as ordered, or not. A booking made from a public request is marked through
     * the request. Marking again keeps the first who and when.
     */
    @Transactional
    void setGuards(User actor, SetGuards body) {
        requireSystemAdmin(actor);
        UUID requestId = body.publicRequestId();
        UUID bookingId = null;
        if (requestId == null) {
            if (body.bookingId() == null) {
                throw new ApiException(ErrorCode.VALIDATION, "Velg en booking eller en forespørsel.");
            }
            if (!exists("SELECT count(*) FROM bookings WHERE id = ?", body.bookingId())) {
                throw new ApiException(ErrorCode.NOT_FOUND, "Bookingen finnes ikke.");
            }
            requestId = jdbc.query("SELECT id FROM public_requests WHERE booking_id = ?",
                    (rs, i) -> rs.getObject("id", UUID.class), body.bookingId()).stream().findFirst().orElse(null);
            if (requestId == null) {
                bookingId = body.bookingId();
            }
        } else if (!exists("SELECT count(*) FROM public_requests WHERE id = ?", requestId)) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Forespørselen finnes ikke.");
        }

        if (body.ordered()) {
            jdbc.update("""
                    INSERT INTO guard_orders (booking_id, public_request_id, ordered_at, ordered_by_id)
                    VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING
                    """, bookingId, requestId, Timestamp.from(clock.instant()), actor.getId());
        } else if (bookingId != null) {
            jdbc.update("DELETE FROM guard_orders WHERE booking_id = ?", bookingId);
        } else {
            jdbc.update("DELETE FROM guard_orders WHERE public_request_id = ?", requestId);
        }
    }

    private boolean exists(String sql, UUID id) {
        Long count = jdbc.queryForObject(sql, Long.class, id);
        return count != null && count > 0;
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static void requireSystemAdmin(User actor) {
        if (!actor.isSystemAdmin()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bare systemadministratorer har tilgang.");
        }
    }
}
