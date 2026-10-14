package no.vtvest.booking.organization;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface OrganizationRepository extends JpaRepository<Organization, UUID> {

    /**
     * Reads the organization with a shared lock (FOR SHARE) for the rest of the transaction, so an
     * administrator can't archive it between this check and the new booking being written.
     */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select o from Organization o where o.id = :id")
    Optional<Organization> findByIdForBooking(UUID id);
}
