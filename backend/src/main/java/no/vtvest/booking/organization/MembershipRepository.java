package no.vtvest.booking.organization;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface MembershipRepository extends JpaRepository<Membership, MembershipId> {

    List<Membership> findByIdUserId(UUID userId);

    /**
     * Reads the membership with a shared lock (FOR SHARE), so it can't be removed between this
     * check and the new booking being written (the removal cancels the member's pending requests).
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select m from Membership m where m.id = :id")
    Optional<Membership> findByIdForBooking(MembershipId id);
}
