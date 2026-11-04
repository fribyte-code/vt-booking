package no.vtvest.booking.publicrequest;

import static no.vtvest.booking.publicrequest.PublicRequestDtos.*;

import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.booking.BookingResponse;
import no.vtvest.booking.booking.CreateBookingRequest;
import no.vtvest.booking.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Booking requests from the public form. {@code POST /api/public/requests} is the only endpoint
 * that works without logging in (see SecurityConfig); it answers 204 and returns nothing, so the
 * sender learns nothing about other requests. The rest is for system admins.
 */
@RestController
class PublicRequestController {

    private final PublicRequestService requests;
    private final CurrentUser currentUser;

    PublicRequestController(PublicRequestService requests, CurrentUser currentUser) {
        this.requests = requests;
        this.currentUser = currentUser;
    }

    @PostMapping("/api/public/requests")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void submit(@Valid @RequestBody SubmitPublicRequest body) {
        requests.submit(body);
    }

    @GetMapping("/api/admin/public-requests")
    List<PublicRequest> list() {
        return requests.list(currentUser.require());
    }

    @PostMapping("/api/admin/public-requests/{id}/reject")
    PublicRequest reject(@PathVariable UUID id) {
        return requests.reject(currentUser.require(), id);
    }

    /** Creates the booking through the normal booking rules and links it to the request. */
    @PostMapping("/api/admin/public-requests/{id}/booking")
    ResponseEntity<BookingResponse> createBooking(@PathVariable UUID id, @Valid @RequestBody CreateBookingRequest body) {
        BookingResponse booking = requests.createBooking(currentUser.require(), id, body);
        return ResponseEntity.created(URI.create("/api/bookings/" + booking.id())).body(booking);
    }
}
