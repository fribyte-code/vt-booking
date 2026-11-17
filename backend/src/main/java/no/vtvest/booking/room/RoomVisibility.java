package no.vtvest.booking.room;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import no.vtvest.booking.user.User;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Hidden rooms ({@code rooms.hidden_without_access}, Q-40): the single source of which rooms a user
 * may not see, read from the database on every request.
 *
 * <p>A hidden room is visible to system admins, to its managers (ORG_ADMINs of the active managing
 * organization, see RoomManagement), and to members of an active organization whose configured
 * permission for the room (override, else the room's default) is not NONE. The room's own status
 * is ignored here, so members keep seeing a closed room they normally have access to.
 */
@Component
public class RoomVisibility {

    private final JdbcTemplate jdbc;

    RoomVisibility(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** The rooms hidden from the user. Always empty for system admins. */
    public Set<UUID> hiddenRoomIds(User user) {
        if (user.isSystemAdmin()) {
            return Set.of();
        }
        return new HashSet<>(jdbc.queryForList("""
                SELECT r.id FROM rooms r
                WHERE r.hidden_without_access
                  AND NOT EXISTS (
                      SELECT 1 FROM organizations o
                      JOIN memberships m ON m.organization_id = o.id AND m.user_id = ? AND m.role = 'ORG_ADMIN'
                      WHERE o.id = r.managing_organization_id AND o.status = 'ACTIVE')
                  AND NOT EXISTS (
                      SELECT 1 FROM memberships m
                      JOIN organizations o ON o.id = m.organization_id AND o.status = 'ACTIVE'
                      LEFT JOIN room_access ra ON ra.room_id = r.id AND ra.organization_id = o.id
                      WHERE m.user_id = ? AND coalesce(ra.permission, r.default_permission) <> 'NONE')
                """, UUID.class, user.getId(), user.getId()));
    }
}
