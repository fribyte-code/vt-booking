package no.vtvest.booking.booking;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface BookingRepository extends JpaRepository<Booking, UUID> {

    /** Half-open overlap with [start, end), counting only bookings that occupy the room. */
    @Query("""
            select count(b) > 0 from Booking b
            where b.roomId = :roomId and b.status = 'APPROVED'
              and b.startAt < :end and b.endAt > :start
            """)
    boolean existsApprovedOverlap(UUID roomId, Instant start, Instant end);

    /** As {@link #existsApprovedOverlap}, ignoring the booking being approved. */
    @Query("""
            select count(b) > 0 from Booking b
            where b.roomId = :roomId and b.status = 'APPROVED' and b.id <> :excludeId
              and b.startAt < :end and b.endAt > :start
            """)
    boolean existsOtherApprovedOverlap(UUID roomId, Instant start, Instant end, UUID excludeId);

    @Query("""
            select b from Booking b
            where b.status in :statuses and b.startAt < :to and b.endAt > :from
            order by b.startAt
            """)
    List<Booking> findInRange(Collection<BookingStatus> statuses, Instant from, Instant to);

    @Query("""
            select b from Booking b
            where b.roomId = :roomId and b.status in :statuses and b.startAt < :to and b.endAt > :from
            order by b.startAt
            """)
    List<Booking> findInRangeForRoom(UUID roomId, Collection<BookingStatus> statuses, Instant from, Instant to);

    /** The requester's own bookings, all statuses, that ended after {@code since}. */
    List<Booking> findByRequestedByIdAndEndAtAfterOrderByStartAt(UUID requestedById, Instant since);

    List<Booking> findByStatusOrderByStartAt(BookingStatus status);

    /** The most recently decided requests, for the admin history. */
    List<Booking> findTop50ByRequiresApprovalTrueAndDecidedAtNotNullOrderByDecidedAtDesc();
}
