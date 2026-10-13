package no.vtvest.booking.admin;

import static no.vtvest.booking.admin.AdminDtos.*;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.organization.MembershipRole;
import no.vtvest.booking.organization.OrganizationStatus;
import no.vtvest.booking.room.Permission;
import no.vtvest.booking.room.RoomStatus;
import no.vtvest.booking.user.AccountService;
import no.vtvest.booking.user.GlobalRole;
import no.vtvest.booking.user.User;
import no.vtvest.booking.user.UserStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Everything a SYSTEM_ADMIN manages: users, organizations, memberships, rooms and room access. */
@Service
class AdminService {

    private final JdbcTemplate jdbc;
    private final AccountService accounts;

    AdminService(JdbcTemplate jdbc, AccountService accounts) {
        this.jdbc = jdbc;
        this.accounts = accounts;
    }

    static void requireSystemAdmin(User actor) {
        if (!actor.isSystemAdmin()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bare systemadministratorer har tilgang.");
        }
    }

    // ── Users ──────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    List<AdminUser> listUsers() {
        Map<UUID, List<UserMembership>> memberships = jdbc.query(
                        "SELECT user_id, organization_id, role FROM memberships",
                        (rs, i) -> Map.entry(rs.getObject("user_id", UUID.class), new UserMembership(
                                rs.getObject("organization_id", UUID.class), MembershipRole.valueOf(rs.getString("role")))))
                .stream()
                .collect(Collectors.groupingBy(Map.Entry::getKey, Collectors.mapping(Map.Entry::getValue, Collectors.toList())));
        return jdbc.query("SELECT * FROM users ORDER BY lower(display_name), lower(email)",
                (rs, i) -> toUser(rs, memberships.getOrDefault(rs.getObject("id", UUID.class), List.of())));
    }

    private AdminUser user(UUID id) {
        return listUsers().stream().filter(u -> u.id().equals(id)).findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Brukeren finnes ikke."));
    }

    @Transactional
    UserWithPassword createUser(CreateUser body) {
        AccountService.CreatedAccount created =
                accounts.createWithTemporaryPassword(body.email(), body.displayName(), body.globalRole());
        if (body.memberships() != null) {
            for (UserMembership m : body.memberships()) {
                requireOrganization(m.organizationId());
                jdbc.update("INSERT INTO memberships (user_id, organization_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
                        created.userId(), m.organizationId(), m.role().name());
            }
        }
        return new UserWithPassword(user(created.userId()), created.temporaryPassword());
    }

    @Transactional
    AdminUser updateUser(User actor, UUID id, UpdateUser body) {
        AdminUser target = user(id);
        boolean losesAdmin = target.globalRole() == GlobalRole.SYSTEM_ADMIN
                && ((body.globalRole() != null && body.globalRole() != GlobalRole.SYSTEM_ADMIN)
                        || body.status() == UserStatus.DISABLED);
        if (losesAdmin && id.equals(actor.getId())) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Du kan ikke fjerne din egen administratortilgang eller deaktivere deg selv.");
        }
        if (body.status() == UserStatus.DISABLED && id.equals(actor.getId())) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Du kan ikke deaktivere deg selv.");
        }
        if (losesAdmin) {
            // Serialize admin changes so two admins can't demote each other at the same time.
            jdbc.execute("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
            Integer others = jdbc.queryForObject(
                    "SELECT count(*) FROM users WHERE global_role = 'SYSTEM_ADMIN' AND status = 'ACTIVE' AND id <> ?",
                    Integer.class, id);
            if (others == null || others == 0) {
                throw new ApiException(ErrorCode.CONFLICT, "Det må finnes minst én aktiv systemadministrator.");
            }
        }
        if (body.email() != null) {
            String email = AccountService.normalizeEmail(body.email());
            if (accounts.emailInUse(email, id)) {
                throw new ApiException(ErrorCode.CONFLICT, "Det finnes allerede en bruker med denne e-postadressen.");
            }
            jdbc.update("UPDATE users SET email = ? WHERE id = ?", email, id);
        }
        if (body.displayName() != null) {
            jdbc.update("UPDATE users SET display_name = ? WHERE id = ?", AccountService.requireName(body.displayName()), id);
        }
        if (body.globalRole() != null) {
            jdbc.update("UPDATE users SET global_role = ? WHERE id = ?", body.globalRole().name(), id);
        }
        if (body.status() != null) {
            jdbc.update("UPDATE users SET status = ? WHERE id = ?", body.status().name(), id);
        }
        return user(id);
    }

    @Transactional
    TemporaryPassword resetPassword(User actor, UUID id) {
        if (id.equals(actor.getId())) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bytt ditt eget passord fra brukermenyen.");
        }
        user(id);
        return new TemporaryPassword(accounts.resetToTemporaryPassword(id));
    }

    @Transactional
    AdminUser setMembership(UUID userId, UUID organizationId, MembershipRole role) {
        user(userId);
        requireOrganization(organizationId);
        jdbc.update("""
                INSERT INTO memberships (user_id, organization_id, role) VALUES (?, ?, ?)
                ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role
                """, userId, organizationId, role.name());
        return user(userId);
    }

    @Transactional
    AdminUser removeMembership(UUID userId, UUID organizationId) {
        user(userId);
        jdbc.update("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?", userId, organizationId);
        return user(userId);
    }

    private static AdminUser toUser(ResultSet rs, List<UserMembership> memberships) throws SQLException {
        Timestamp lastLogin = rs.getTimestamp("last_login_at");
        return new AdminUser(
                rs.getObject("id", UUID.class),
                rs.getString("email"),
                rs.getString("display_name"),
                GlobalRole.valueOf(rs.getString("global_role")),
                UserStatus.valueOf(rs.getString("status")),
                rs.getString("password_hash") != null,
                rs.getBoolean("must_change_password"),
                lastLogin == null ? null : lastLogin.toInstant(),
                memberships);
    }

    // ── Organizations ──────────────────────────────────────────────

    @Transactional(readOnly = true)
    List<AdminOrganization> listOrganizations() {
        return jdbc.query("""
                SELECT o.id, o.name, o.status, count(m.user_id) AS members
                FROM organizations o LEFT JOIN memberships m ON m.organization_id = o.id
                GROUP BY o.id ORDER BY o.status, lower(o.name)
                """, (rs, i) -> new AdminOrganization(
                rs.getObject("id", UUID.class), rs.getString("name"),
                OrganizationStatus.valueOf(rs.getString("status")), rs.getInt("members")));
    }

    private AdminOrganization organization(UUID id) {
        return listOrganizations().stream().filter(o -> o.id().equals(id)).findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Organisasjonen finnes ikke."));
    }

    private void requireOrganization(UUID id) {
        organization(id);
    }

    @Transactional
    AdminOrganization createOrganization(CreateOrganization body) {
        String name = body.name().trim();
        requireUniqueOrganizationName(name, null);
        UUID id = jdbc.queryForObject("INSERT INTO organizations (name) VALUES (?) RETURNING id", UUID.class, name);
        return organization(id);
    }

    @Transactional
    AdminOrganization updateOrganization(UUID id, UpdateOrganization body) {
        organization(id);
        if (body.name() != null) {
            String name = body.name().trim();
            requireUniqueOrganizationName(name, id);
            jdbc.update("UPDATE organizations SET name = ? WHERE id = ?", name, id);
        }
        if (body.status() != null) {
            jdbc.update("UPDATE organizations SET status = ? WHERE id = ?", body.status().name(), id);
        }
        return organization(id);
    }

    private void requireUniqueOrganizationName(String name, UUID exceptId) {
        if (name.isEmpty()) throw new ApiException(ErrorCode.VALIDATION, "Navnet kan ikke være tomt.");
        if (Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM organizations WHERE lower(name) = lower(?) AND id IS DISTINCT FROM ?)",
                Boolean.class, name, exceptId))) {
            throw new ApiException(ErrorCode.CONFLICT, "Det finnes allerede en organisasjon med dette navnet.");
        }
    }

    // ── Rooms ──────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    List<AdminRoom> listRooms() {
        Map<UUID, List<RoomAccessEntry>> access = jdbc.query(
                        "SELECT room_id, organization_id, permission FROM room_access",
                        (rs, i) -> Map.entry(rs.getObject("room_id", UUID.class), new RoomAccessEntry(
                                rs.getObject("organization_id", UUID.class), Permission.valueOf(rs.getString("permission")))))
                .stream()
                .collect(Collectors.groupingBy(Map.Entry::getKey, Collectors.mapping(Map.Entry::getValue, Collectors.toList())));
        return jdbc.query("SELECT * FROM rooms ORDER BY status, lower(name)", (rs, i) -> {
            UUID id = rs.getObject("id", UUID.class);
            return new AdminRoom(
                    id,
                    rs.getString("name"),
                    rs.getString("description"),
                    rs.getString("location"),
                    (Integer) rs.getObject("capacity"),
                    rs.getString("color"),
                    RoomStatus.valueOf(rs.getString("status")),
                    Permission.valueOf(rs.getString("default_permission")),
                    new ArrayList<>(access.getOrDefault(id, List.of())));
        });
    }

    private AdminRoom room(UUID id) {
        return listRooms().stream().filter(r -> r.id().equals(id)).findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Rommet finnes ikke."));
    }

    @Transactional
    AdminRoom createRoom(RoomFields body) {
        String name = body.name().trim();
        requireUniqueRoomName(name, null);
        UUID id = jdbc.queryForObject("""
                INSERT INTO rooms (name, description, location, capacity, color, default_permission)
                VALUES (?, ?, ?, ?, ?, ?) RETURNING id
                """, UUID.class, name, blankToNull(body.description()), blankToNull(body.location()),
                body.capacity(), body.color(), body.defaultPermission().name());
        return room(id);
    }

    @Transactional
    AdminRoom updateRoom(UUID id, RoomFields body) {
        room(id);
        String name = body.name().trim();
        requireUniqueRoomName(name, id);
        jdbc.update("""
                UPDATE rooms SET name = ?, description = ?, location = ?, capacity = ?, color = ?, default_permission = ?,
                    status = coalesce(?, status)
                WHERE id = ?
                """, name, blankToNull(body.description()), blankToNull(body.location()), body.capacity(), body.color(),
                body.defaultPermission().name(), body.status() == null ? null : body.status().name(), id);
        return room(id);
    }

    @Transactional
    AdminRoom setRoomAccess(UUID roomId, UUID organizationId, Permission permission) {
        room(roomId);
        requireOrganization(organizationId);
        if (permission == null) {
            jdbc.update("DELETE FROM room_access WHERE room_id = ? AND organization_id = ?", roomId, organizationId);
        } else {
            jdbc.update("""
                    INSERT INTO room_access (room_id, organization_id, permission) VALUES (?, ?, ?)
                    ON CONFLICT (room_id, organization_id) DO UPDATE SET permission = EXCLUDED.permission
                    """, roomId, organizationId, permission.name());
        }
        return room(roomId);
    }

    private void requireUniqueRoomName(String name, UUID exceptId) {
        if (name.isEmpty()) throw new ApiException(ErrorCode.VALIDATION, "Navnet kan ikke være tomt.");
        if (Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM rooms WHERE lower(name) = lower(?) AND id IS DISTINCT FROM ?)",
                Boolean.class, name, exceptId))) {
            throw new ApiException(ErrorCode.CONFLICT, "Det finnes allerede et rom med dette navnet.");
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
