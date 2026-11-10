package no.vtvest.booking.booking;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
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

    /** Requests that can still be decided: pending and not yet started. */
    List<Booking> findByStatusAndStartAtAfterOrderByStartAt(BookingStatus status, Instant after);

    /** The most recently decided requests, for the admin history. */
    List<Booking> findTop50ByRequiresApprovalTrueAndDecidedAtNotNullOrderByDecidedAtDesc();

    List<Booking> findBySeriesIdOrderByStartAt(UUID seriesId);

    // ── Future bookings of a room, organization or user (start after :now) ──

    @Query("""
            select b from Booking b
            where b.roomId = :roomId and b.status in :statuses and b.startAt > :now
            order by b.startAt
            """)
    List<Booking> findFutureInRoom(UUID roomId, Collection<BookingStatus> statuses, Instant now);

    @Query("""
            select b from Booking b
            where b.organizationId = :organizationId and b.status in :statuses and b.startAt > :now
            order by b.startAt
            """)
    List<Booking> findFutureForOrganization(UUID organizationId, Collection<BookingStatus> statuses, Instant now);

    @Query("""
            select b from Booking b
            where b.requestedById = :userId and b.status in :statuses and b.startAt > :now
            order by b.startAt
            """)
    List<Booking> findFutureByRequester(UUID userId, Collection<BookingStatus> statuses, Instant now);

    // ── Row locks for multi-row writes ──
    // Every write that changes several bookings locks them first, ordered by id, so two such
    // writes can't take the same rows in opposite orders. Room locks, where needed, come before.

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select b from Booking b
            where b.roomId = :roomId and b.status in :statuses and b.startAt > :now
            order by b.id
            """)
    List<Booking> lockFutureInRoom(UUID roomId, Collection<BookingStatus> statuses, Instant now);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select b from Booking b
            where b.organizationId = :organizationId and b.status in :statuses and b.startAt > :now
            order by b.id
            """)
    List<Booking> lockFutureForOrganization(UUID organizationId, Collection<BookingStatus> statuses, Instant now);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select b from Booking b
            where b.requestedById = :userId and b.status in :statuses and b.startAt > :now
            order by b.id
            """)
    List<Booking> lockFutureByRequester(UUID userId, Collection<BookingStatus> statuses, Instant now);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select b from Booking b
            where b.requestedById = :userId and b.organizationId = :organizationId
              and b.status in :statuses and b.startAt > :now
            order by b.id
            """)
    List<Booking> lockFutureByRequesterInOrganization(
            UUID userId, UUID organizationId, Collection<BookingStatus> statuses, Instant now);

    /** Every occurrence of a series, locked, ordered by id (see above). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from Booking b where b.seriesId = :seriesId order by b.id")
    List<Booking> lockSeries(UUID seriesId);

    /**
     * Room, organization and requester of each occurrence, read without loading or locking the
     * bookings, so a series write can lock what it depends on before it locks the bookings.
     */
    @Query("select b.roomId, b.organizationId, b.requestedById from Booking b where b.seriesId = :seriesId")
    List<Object[]> seriesKeys(UUID seriesId);

    /** A room manager's queue: pending requests in their rooms. */
    List<Booking> findByStatusAndRoomIdInAndStartAtAfterOrderByStartAt(
            BookingStatus status, java.util.Collection<UUID> roomIds, Instant after);

    List<Booking> findTop50ByRoomIdInAndRequiresApprovalTrueAndDecidedAtNotNullOrderByDecidedAtDesc(
            java.util.Collection<UUID> roomIds);
}
