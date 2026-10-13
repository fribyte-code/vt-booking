package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import no.vtvest.booking.booking.ApproveBookingRequest;
import no.vtvest.booking.booking.BookingResponse;
import no.vtvest.booking.booking.BookingService;
import no.vtvest.booking.booking.CreateBookingRequest;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.user.User;
import no.vtvest.booking.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

class BookingConcurrencyIntegrationTest extends IntegrationTest {

    private static final int THREADS = 16;

    @Autowired
    BookingService bookingService;

    @Autowired
    UserRepository users;

    @Test
    void parallelBookingsForTheSameSlotLeaveExactlyOneApproved() throws Exception {
        User kari = users.findById(KARI_ID).orElseThrow();
        User ola = users.findById(OLA_ID).orElseThrow();
        Instant start = at(10, 14);
        Instant end = at(10, 16);

        CountDownLatch go = new CountDownLatch(1);
        List<Callable<String>> tasks = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            boolean even = i % 2 == 0;
            CreateBookingRequest request = new CreateBookingRequest(
                    ROOM_A,
                    even ? ORG_A : ORG_B,
                    "Samtidig " + i,
                    null,
                    start.atOffset(ZoneOffset.UTC),
                    end.atOffset(ZoneOffset.UTC));
            tasks.add(() -> {
                go.await();
                try {
                    bookingService.create(even ? kari : ola, request);
                    return "OK";
                } catch (ApiException e) {
                    return e.code().name();
                }
            });
        }

        List<String> results = new ArrayList<>();
        try (ExecutorService pool = Executors.newFixedThreadPool(THREADS)) {
            List<Future<String>> futures = tasks.stream().map(pool::submit).toList();
            go.countDown();
            for (Future<String> f : futures) results.add(f.get());
        }

        assertThat(results).filteredOn("OK"::equals).hasSize(1);
        assertThat(results).filteredOn(ErrorCode.CONFLICT.name()::equals).hasSize(THREADS - 1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM bookings WHERE status = 'APPROVED'", Integer.class))
                .isEqualTo(1);
    }

    @Test
    void parallelApprovalsOfOverlappingRequestsLeaveExactlyOneApproved() throws Exception {
        User kari = users.findById(KARI_ID).orElseThrow();
        User ola = users.findById(OLA_ID).orElseThrow();
        User admin = users.findById(ADMIN_ID).orElseThrow();
        Instant start = at(12, 18);

        // Pending requests may overlap; each one ends 0..N-1 minutes later so all of them clash.
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            boolean even = i % 2 == 0;
            BookingResponse pending = bookingService.create(even ? kari : ola, new CreateBookingRequest(
                    STORSALEN,
                    even ? ORG_A : ORG_B,
                    "Søknad " + i,
                    null,
                    start.atOffset(ZoneOffset.UTC),
                    start.plusSeconds(3600 + 60L * i).atOffset(ZoneOffset.UTC)));
            ids.add(pending.id());
        }

        List<String> results = runConcurrently(ids.stream()
                .map(id -> (Callable<BookingResponse>) () -> bookingService.approve(admin, id, new ApproveBookingRequest(0, null)))
                .toList());

        assertThat(results).filteredOn("OK"::equals).hasSize(1);
        assertThat(results).filteredOn(ErrorCode.CONFLICT.name()::equals).hasSize(THREADS - 1);
        assertThat(jdbc.queryForObject(
                        "SELECT count(*) FROM bookings WHERE room_id = ? AND status = 'APPROVED'", Integer.class, STORSALEN))
                .isEqualTo(1);
    }

    @Test
    void parallelApprovalsOfTheSameRequestSucceedOnce() throws Exception {
        User kari = users.findById(KARI_ID).orElseThrow();
        User admin = users.findById(ADMIN_ID).orElseThrow();
        UUID id = bookingService.create(kari, new CreateBookingRequest(
                        STORSALEN, ORG_A, "Søknad", null,
                        at(12, 10).atOffset(ZoneOffset.UTC), at(12, 11).atOffset(ZoneOffset.UTC)))
                .id();

        List<Callable<BookingResponse>> tasks = new ArrayList<>();
        for (int i = 0; i < THREADS; i++) {
            tasks.add(() -> bookingService.approve(admin, id, new ApproveBookingRequest(0, null)));
        }
        List<String> results = runConcurrently(tasks);

        // Losers either see the committed approval (INVALID_STATE) or lose the version race (VERSION_CONFLICT).
        assertThat(results).filteredOn("OK"::equals).hasSize(1);
        assertThat(results).filteredOn(r -> !r.equals("OK"))
                .allMatch(r -> Set.of(ErrorCode.INVALID_STATE.name(), ErrorCode.VERSION_CONFLICT.name()).contains(r));
        assertThat(jdbc.queryForObject("SELECT version FROM bookings WHERE id = ?", Integer.class, id)).isEqualTo(1);
    }

    /** Starts all tasks at the same moment and returns "OK" or the error code for each. */
    private static List<String> runConcurrently(List<? extends Callable<?>> tasks) throws Exception {
        CountDownLatch go = new CountDownLatch(1);
        List<String> results = new ArrayList<>();
        try (ExecutorService pool = Executors.newFixedThreadPool(tasks.size())) {
            List<Future<String>> futures = tasks.stream()
                    .map(task -> pool.submit(() -> {
                        go.await();
                        try {
                            task.call();
                            return "OK";
                        } catch (ApiException e) {
                            return e.code().name();
                        }
                    }))
                    .toList();
            go.countDown();
            for (Future<String> f : futures) results.add(f.get());
        }
        return results;
    }

    @Test
    void databaseRejectsOverlappingApprovedBookingsEvenWithoutTheService() {
        String insert = """
                INSERT INTO bookings (room_id, organization_id, requested_by_id, title, start_at, end_at, status, requires_approval)
                VALUES (?, ?, ?, ?, ?::timestamptz, ?::timestamptz, ?, false)
                """;
        jdbc.update(insert, ROOM_A, ORG_A, KARI_ID, "Første", at(10, 8).toString(), at(10, 10).toString(), "APPROVED");

        assertThatThrownBy(() -> jdbc.update(
                        insert, ROOM_A, ORG_B, OLA_ID, "Overlapp", at(10, 9).toString(), at(10, 11).toString(), "APPROVED"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("bookings_no_overlap");

        // Pending and cancelled rows may overlap; another room is unaffected.
        jdbc.update(insert, ROOM_A, ORG_B, OLA_ID, "Søknad", at(10, 9).toString(), at(10, 11).toString(), "PENDING");
        jdbc.update(insert, ROOM_B, ORG_A, KARI_ID, "Annet rom", at(10, 9).toString(), at(10, 11).toString(), "APPROVED");
    }
}
