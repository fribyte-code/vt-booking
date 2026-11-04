package no.vtvest.booking.publicrequest;

import static no.vtvest.booking.publicrequest.PublicRequestDtos.*;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.booking.BookingResponse;
import no.vtvest.booking.booking.BookingService;
import no.vtvest.booking.booking.CreateBookingRequest;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
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

    /** Generous on purpose: the admin adjusts the time when making the booking, where the booking rules apply. */
    static final Duration MAX_DURATION = Duration.ofHours(24);

    private final JdbcTemplate jdbc;
    private final BookingService bookingService;
    private final Clock clock;

    PublicRequestService(JdbcTemplate jdbc, BookingService bookingService, Clock clock) {
        this.jdbc = jdbc;
        this.bookingService = bookingService;
        this.clock = clock;
    }

    @Transactional
    void submit(SubmitPublicRequest body) {
        Instant start = body.start().toInstant();
        Instant end = body.end().toInstant();
        if (!end.isAfter(start)) {
            throw new ApiException(ErrorCode.VALIDATION, "Sluttidspunktet må være etter starttidspunktet.");
        }
        if (Duration.between(start, end).compareTo(MAX_DURATION) > 0) {
            throw new ApiException(ErrorCode.VALIDATION, "Arrangementet kan vare i høyst 24 timer.");
        }
        if (!start.isAfter(clock.instant())) {
            throw new ApiException(ErrorCode.VALIDATION, "Tidspunktet har allerede vært.");
        }
        jdbc.update("""
                INSERT INTO public_requests (email, organization_name, event_name, member_of_kulturstyret_or_samfunnet,
                    preferred_area, start_at, end_at, description, needs_villa_guard, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                AccountService.normalizeEmail(body.email()),
                body.organizationName().strip(),
                body.eventName().strip(),
                body.memberOfKulturstyretOrSamfunnet(),
                body.preferredArea().name(),
                Timestamp.from(start),
                Timestamp.from(end),
                body.description().strip(),
                body.needsVillaGuard(),
                Timestamp.from(clock.instant()));
    }

    /** Newest first. */
    @Transactional(readOnly = true)
    List<PublicRequest> list(User actor) {
        requireSystemAdmin(actor);
        return jdbc.query("SELECT * FROM public_requests ORDER BY created_at DESC", PublicRequestService::toRequest);
    }

    @Transactional
    PublicRequest reject(User actor, UUID id) {
        requireSystemAdmin(actor);
        lockNew(id);
        jdbc.update("UPDATE public_requests SET status = 'REJECTED' WHERE id = ?", id);
        return find(id);
    }

    /**
     * Creates the booking and marks the request as transferred, in one transaction: if the booking
     * is refused (conflict, missing access, invalid time), the request stays NEW.
     */
    @Transactional
    BookingResponse createBooking(User actor, UUID id, CreateBookingRequest booking) {
        requireSystemAdmin(actor);
        lockNew(id);
        BookingResponse created = bookingService.createOnBehalf(actor, booking);
        jdbc.update("UPDATE public_requests SET status = 'TRANSFERRED', booking_id = ? WHERE id = ?", created.id(), id);
        return created;
    }

    private static void requireSystemAdmin(User actor) {
        if (!actor.isSystemAdmin()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bare systemadministratorer har tilgang.");
        }
    }

    /** Locks the request, so two admins can't handle it at the same time, and requires it to be unhandled. */
    private void lockNew(UUID id) {
        String status = jdbc.query("SELECT status FROM public_requests WHERE id = ? FOR UPDATE",
                        (rs, i) -> rs.getString("status"), id)
                .stream().findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Forespørselen finnes ikke."));
        if (!Status.NEW.name().equals(status)) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Forespørselen er allerede behandlet.");
        }
    }

    private PublicRequest find(UUID id) {
        return jdbc.queryForObject("SELECT * FROM public_requests WHERE id = ?", PublicRequestService::toRequest, id);
    }

    private static PublicRequest toRequest(ResultSet rs, int row) throws SQLException {
        return new PublicRequest(
                rs.getObject("id", UUID.class),
                rs.getString("email"),
                rs.getString("organization_name"),
                rs.getString("event_name"),
                rs.getBoolean("member_of_kulturstyret_or_samfunnet"),
                PreferredArea.valueOf(rs.getString("preferred_area")),
                rs.getTimestamp("start_at").toInstant(),
                rs.getTimestamp("end_at").toInstant(),
                rs.getString("description"),
                rs.getBoolean("needs_villa_guard"),
                Status.valueOf(rs.getString("status")),
                rs.getTimestamp("created_at").toInstant(),
                rs.getObject("booking_id", UUID.class));
    }
}
