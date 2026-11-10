package no.vtvest.booking.room;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Room managers: the ORG_ADMINs of the active organization a room is managed by
 * ({@code rooms.managing_organization_id}). They see, approve and reject the room's requests, like
 * system admins; everything else about the room stays with system admins. The single source of
 * which rooms a user manages, read from the database on every request.
 */
@Component
public class RoomManagement {

    private final JdbcTemplate jdbc;

    RoomManagement(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The rooms the user manages as ORG_ADMIN of the managing organization. Not system admin rights. */
    public Set<UUID> managedRoomIds(UUID userId) {
        return new HashSet<>(jdbc.queryForList("""
                SELECT r.id FROM rooms r
                JOIN organizations o ON o.id = r.managing_organization_id AND o.status = 'ACTIVE'
                JOIN memberships m ON m.organization_id = o.id AND m.user_id = ? AND m.role = 'ORG_ADMIN'
                """, UUID.class, userId));
    }
}
