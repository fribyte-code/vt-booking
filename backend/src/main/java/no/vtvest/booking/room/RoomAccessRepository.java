package no.vtvest.booking.room;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoomAccessRepository extends JpaRepository<RoomAccess, RoomAccessId> {

    List<RoomAccess> findByIdOrganizationIdIn(Collection<UUID> organizationIds);
}
