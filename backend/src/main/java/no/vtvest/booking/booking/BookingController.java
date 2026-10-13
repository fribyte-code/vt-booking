package no.vtvest.booking.booking;

import jakarta.validation.Valid;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.security.CurrentUser;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/bookings")
class BookingController {

    private final BookingService bookingService;
    private final CurrentUser currentUser;

    BookingController(BookingService bookingService, CurrentUser currentUser) {
        this.bookingService = bookingService;
        this.currentUser = currentUser;
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
}
