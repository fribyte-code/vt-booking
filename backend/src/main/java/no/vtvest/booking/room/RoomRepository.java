package no.vtvest.booking.room;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface RoomRepository extends JpaRepository<Room, UUID> {

    List<Room> findByStatusNotOrderByName(RoomStatus status);

    /**
     * Locks the room row for the rest of the transaction. Booking writes for the same room take
     * this lock first, so they run one at a time: the overlap check is then reliable, and
     * concurrent overlapping inserts cannot deadlock on the exclusion constraint.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Room r where r.id = :id")
    Optional<Room> findByIdForBooking(UUID id);
}
