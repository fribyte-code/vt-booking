package no.vtvest.booking.booking;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.room.Room;
import no.vtvest.booking.room.RoomRepository;
import no.vtvest.booking.user.User;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Approved bookings as an iCalendar file (RFC 5545), for "Legg til i kalender". Apple Calendar has
 * no add-event link, but Safari on iPhone opens a {@code text/calendar} response straight in the
 * Calendar app. Visibility follows the JSON endpoints, so the description is only included for the
 * booking's own organization and administrators.
 */
@Service
public class CalendarExport {

    private static final DateTimeFormatter UTC = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);

    private final BookingService bookingService;
    private final BookingSeriesService seriesService;
    private final RoomRepository rooms;
    private final Clock clock;

    CalendarExport(BookingService bookingService, BookingSeriesService seriesService, RoomRepository rooms, Clock clock) {
        this.bookingService = bookingService;
        this.seriesService = seriesService;
        this.rooms = rooms;
        this.clock = clock;
    }

    /** One approved booking. */
    @Transactional(readOnly = true)
    public String booking(User actor, UUID id) {
        BookingResponse booking = bookingService.get(actor, id);
        if (booking.status() != BookingStatus.APPROVED) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Bare godkjente bookinger kan legges i kalenderen.");
        }
        return calendar(List.of(booking));
    }

    /**
     * The approved occurrences of a series that have not ended, one event each. Moved or cancelled
     * occurrences stay correct this way, which a recurrence rule could not express.
     */
    @Transactional(readOnly = true)
    public String series(User actor, UUID seriesId) {
        Instant now = clock.instant();
        List<BookingResponse> upcoming = seriesService.get(actor, seriesId).stream()
                .filter(b -> b.status() == BookingStatus.APPROVED && b.end().isAfter(now))
                .toList();
        if (upcoming.isEmpty()) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Serien har ingen kommende godkjente bookinger.");
        }
        return calendar(upcoming);
    }

    private String calendar(List<BookingResponse> bookings) {
        String stamp = UTC.format(clock.instant().truncatedTo(ChronoUnit.SECONDS));
        StringBuilder ics = new StringBuilder();
        line(ics, "BEGIN:VCALENDAR");
        line(ics, "VERSION:2.0");
        line(ics, "PRODID:-//Velferdstinget Vest//Rombooking//NO");
        line(ics, "CALSCALE:GREGORIAN");
        line(ics, "METHOD:PUBLISH");
        for (BookingResponse b : bookings) {
            line(ics, "BEGIN:VEVENT");
            line(ics, "UID:" + b.id() + "@rombooking.vtvest.no");
            line(ics, "DTSTAMP:" + stamp);
            line(ics, "DTSTART:" + UTC.format(b.start()));
            line(ics, "DTEND:" + UTC.format(b.end()));
            line(ics, "SEQUENCE:" + b.version());
            line(ics, "SUMMARY:" + text(b.title()));
            line(ics, "LOCATION:" + text(location(b)));
            line(ics, "DESCRIPTION:" + text(description(b)));
            line(ics, "END:VEVENT");
        }
        line(ics, "END:VCALENDAR");
        return ics.toString();
    }

    private String location(BookingResponse b) {
        String location = rooms.findById(b.roomId()).map(Room::getLocation).orElse(null);
        return location == null || location.isBlank() ? b.roomName() : b.roomName() + ", " + location;
    }

    private static String description(BookingResponse b) {
        String org = "Booket for " + b.organizationName();
        return b.description() == null ? org : org + "\n\n" + b.description();
    }

    /** Escapes a TEXT value (RFC 5545 3.3.11). */
    static String text(String value) {
        return value.replace("\\", "\\\\")
                .replace(";", "\\;")
                .replace(",", "\\,")
                .replace("\r\n", "\\n")
                .replace("\n", "\\n")
                .replace("\r", "\\n");
    }

    /** Appends a content line folded at 75 octets, without splitting a UTF-8 character (RFC 5545 3.1). */
    static void line(StringBuilder ics, String content) {
        int octets = 0;
        for (int i = 0; i < content.length(); ) {
            int codePoint = content.codePointAt(i);
            int size = new String(Character.toChars(codePoint)).getBytes(StandardCharsets.UTF_8).length;
            if (octets + size > 75) {
                ics.append("\r\n ");
                octets = 1;
            }
            ics.appendCodePoint(codePoint);
            octets += size;
            i += Character.charCount(codePoint);
        }
        ics.append("\r\n");
    }
}
