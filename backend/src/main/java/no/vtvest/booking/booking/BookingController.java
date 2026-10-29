package no.vtvest.booking.booking;

import static no.vtvest.booking.booking.SeriesDtos.*;

import jakarta.validation.Valid;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.security.CurrentUser;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/bookings")
class BookingController {

    private final BookingService bookingService;
    private final BookingSeriesService seriesService;
    private final CalendarExport calendarExport;
    private final CurrentUser currentUser;

    BookingController(BookingService bookingService, BookingSeriesService seriesService, CalendarExport calendarExport,
            CurrentUser currentUser) {
        this.bookingService = bookingService;
        this.seriesService = seriesService;
        this.calendarExport = calendarExport;
        this.currentUser = currentUser;
    }

    private static final MediaType TEXT_CALENDAR = MediaType.parseMediaType("text/calendar;charset=UTF-8");

    /** Inline, so Safari on iPhone opens it in the Calendar app instead of saving a file. */
    private static ResponseEntity<String> calendarFile(String ics) {
        return ResponseEntity.ok()
                .contentType(TEXT_CALENDAR)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.inline().filename("booking.ics").build().toString())
                .body(ics);
    }

    @GetMapping
    List<BookingResponse> list(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime to,
            @RequestParam(required = false) UUID roomId) {
        return bookingService.list(currentUser.require(), from.toInstant(), to.toInstant(), roomId);
    }

    /** The current user's own bookings and requests. */
    @GetMapping("/mine")
    List<BookingResponse> mine() {
        return bookingService.mine(currentUser.require());
    }

    /** Admin only: pending requests and recently decided ones. */
    @GetMapping("/requests")
    List<BookingResponse> requests() {
        return bookingService.requests(currentUser.require());
    }

    @GetMapping("/{id}")
    BookingResponse get(@PathVariable UUID id) {
        return bookingService.get(currentUser.require(), id);
    }

    /** An approved booking as an iCalendar file, for "Legg til i kalender". */
    @GetMapping("/{id}/calendar.ics")
    ResponseEntity<String> calendar(@PathVariable UUID id) {
        return calendarFile(calendarExport.booking(currentUser.require(), id));
    }

    @PostMapping("/{id}/approve")
    BookingResponse approve(@PathVariable UUID id, @Valid @RequestBody ApproveBookingRequest request) {
        return bookingService.approve(currentUser.require(), id, request);
    }

    @PostMapping("/{id}/reject")
    BookingResponse reject(@PathVariable UUID id, @Valid @RequestBody RejectBookingRequest request) {
        return bookingService.reject(currentUser.require(), id, request);
    }

    @PostMapping("/{id}/cancel")
    BookingResponse cancel(@PathVariable UUID id, @Valid @RequestBody CancelBookingRequest request) {
        return bookingService.cancel(currentUser.require(), id, request);
    }

    @PostMapping
    ResponseEntity<BookingResponse> create(@Valid @RequestBody CreateBookingRequest request) {
        BookingResponse booking = bookingService.create(currentUser.require(), request);
        return ResponseEntity.created(URI.create("/api/bookings/" + booking.id())).body(booking);
    }

    @PutMapping("/{id}")
    BookingResponse update(@PathVariable UUID id, @Valid @RequestBody UpdateBookingRequest request) {
        return bookingService.update(currentUser.require(), id, request);
    }

    // ── Weekly series ─────────────────────────────────────────────

    @PostMapping("/series/preview")
    SeriesPreview previewSeries(@Valid @RequestBody CreateSeriesRequest request) {
        return seriesService.preview(currentUser.require(), request);
    }

    @PostMapping("/series")
    ResponseEntity<SeriesCreated> createSeries(@Valid @RequestBody CreateSeriesRequest request) {
        SeriesCreated series = seriesService.create(currentUser.require(), request);
        return ResponseEntity.created(URI.create("/api/bookings/series/" + series.seriesId())).body(series);
    }

    @GetMapping("/series/{seriesId}")
    List<BookingResponse> series(@PathVariable UUID seriesId) {
        return seriesService.get(currentUser.require(), seriesId);
    }

    /** The series' upcoming approved occurrences as an iCalendar file. */
    @GetMapping("/series/{seriesId}/calendar.ics")
    ResponseEntity<String> seriesCalendar(@PathVariable UUID seriesId) {
        return calendarFile(calendarExport.series(currentUser.require(), seriesId));
    }

    /** Edits an occurrence and the following ones. */
    @PutMapping("/series/{seriesId}")
    SeriesUpdated updateSeries(@PathVariable UUID seriesId, @Valid @RequestBody SeriesUpdateRequest request) {
        return seriesService.update(currentUser.require(), seriesId, request);
    }

    @PostMapping("/series/{seriesId}/cancel")
    List<BookingResponse> cancelSeries(@PathVariable UUID seriesId, @Valid @RequestBody SeriesCancelRequest request) {
        return seriesService.cancel(currentUser.require(), seriesId, request);
    }

    @PostMapping("/series/{seriesId}/approve")
    SeriesApproved approveSeries(@PathVariable UUID seriesId, @Valid @RequestBody SeriesApproveRequest request) {
        return seriesService.approve(currentUser.require(), seriesId, request);
    }

    @PostMapping("/series/{seriesId}/reject")
    List<BookingResponse> rejectSeries(@PathVariable UUID seriesId, @Valid @RequestBody SeriesRejectRequest request) {
        return seriesService.reject(currentUser.require(), seriesId, request);
    }
}
