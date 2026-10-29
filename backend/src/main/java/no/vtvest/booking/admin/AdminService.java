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
import no.vtvest.booking.booking.BookingResponse;
import no.vtvest.booking.booking.BookingService;
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
    private final BookingService bookingService;

    AdminService(JdbcTemplate jdbc, AccountService accounts, BookingService bookingService) {
        this.jdbc = jdbc;
        this.accounts = accounts;
        this.bookingService = bookingService;
    }

    static void requireSystemAdmin(User actor) {
        if (!actor.isSystemAdmin()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bare systemadministratorer har tilgang.");
        }
    }

    // ── Users ──────────────────────────────────────────────────────

    @Transactional(readOnly = true)
    List<AdminUser> listUsers() {
        Map<UUID, List<UserMembership>> memberships =
                membershipsByUser("SELECT user_id, organization_id, role FROM memberships");
        return jdbc.query("SELECT * FROM users ORDER BY lower(display_name), lower(email)",
                (rs, i) -> toUser(rs, memberships.getOrDefault(rs.getObject("id", UUID.class), List.of())));
    }

    private AdminUser user(UUID id) {
        Map<UUID, List<UserMembership>> memberships =
                membershipsByUser("SELECT user_id, organization_id, role FROM memberships WHERE user_id = ?", id);
        return jdbc.query("SELECT * FROM users WHERE id = ?",
                        (rs, i) -> toUser(rs, memberships.getOrDefault(id, List.of())), id)
                .stream().findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Brukeren finnes ikke."));
    }

    private Map<UUID, List<UserMembership>> membershipsByUser(String sql, Object... args) {
        return jdbc.query(sql, (rs, i) -> Map.entry(rs.getObject("user_id", UUID.class), new UserMembership(
                        rs.getObject("organization_id", UUID.class), MembershipRole.valueOf(rs.getString("role")))), args)
                .stream()
                .collect(Collectors.groupingBy(Map.Entry::getKey, Collectors.mapping(Map.Entry::getValue, Collectors.toList())));
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
        if (body.status() == UserStatus.DISABLED) {
            // Approved bookings belong to the organization, so they are only cancelled on request.
            bookingService.cancelFuture(actor, BookingService.Scope.REQUESTER, id,
                    Boolean.TRUE.equals(body.cancelFutureBookings()), "Brukeren er deaktivert.");
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
        // A pending invitation to the same organization is settled by this.
        jdbc.update("DELETE FROM membership_invitations WHERE user_id = ? AND organization_id = ?", userId, organizationId);
        return user(userId);
    }

    @Transactional
    AdminUser removeMembership(User actor, UUID userId, UUID organizationId) {
        user(userId);
        int removed = jdbc.update("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?", userId, organizationId);
        if (removed > 0) {
            bookingService.cancelFutureRequestsOfFormerMember(actor, userId, organizationId);
        }
        return user(userId);
    }

    /** Future approved and pending bookings of a room, organization or requester, for the impact preview. */
    @Transactional(readOnly = true)
    List<BookingResponse> futureBookings(User actor, BookingService.Scope scope, UUID id) {
        switch (scope) {
            case ROOM -> room(id);
            case ORGANIZATION -> organization(id);
            case REQUESTER -> user(id);
        }
        return bookingService.futureBookings(actor, scope, id);
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

    private static final String ORGANIZATIONS = """
            SELECT o.id, o.name, o.status, count(m.user_id) AS members
            FROM organizations o LEFT JOIN memberships m ON m.organization_id = o.id
            """;

    @Transactional(readOnly = true)
    List<AdminOrganization> listOrganizations() {
        return jdbc.query(ORGANIZATIONS + "GROUP BY o.id ORDER BY o.status, lower(o.name)", AdminService::toOrganization);
    }

    private static AdminOrganization toOrganization(ResultSet rs, int row) throws SQLException {
        return new AdminOrganization(
                rs.getObject("id", UUID.class), rs.getString("name"),
                OrganizationStatus.valueOf(rs.getString("status")), rs.getInt("members"));
    }

    private AdminOrganization organization(UUID id) {
        return jdbc.query(ORGANIZATIONS + "WHERE o.id = ? GROUP BY o.id", AdminService::toOrganization, id)
                .stream().findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Organisasjonen finnes ikke."));
    }

    private void requireOrganization(UUID id) {
        if (!Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM organizations WHERE id = ?)", Boolean.class, id))) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Organisasjonen finnes ikke.");
        }
    }

    @Transactional
    AdminOrganization createOrganization(CreateOrganization body) {
        String name = body.name().trim();
        requireUniqueOrganizationName(name, null);
        UUID id = jdbc.queryForObject("INSERT INTO organizations (name) VALUES (?) RETURNING id", UUID.class, name);
        return organization(id);
    }

    /**
     * Archiving deletes the organization's pending invitations. Its future bookings are cancelled
     * only when asked; otherwise they stay. Restoring the organization does not bring back either.
     */
    @Transactional
    AdminOrganization updateOrganization(User actor, UUID id, UpdateOrganization body) {
        organization(id);
        if (body.name() != null) {
            String name = body.name().trim();
            requireUniqueOrganizationName(name, id);
            jdbc.update("UPDATE organizations SET name = ? WHERE id = ?", name, id);
        }
        if (body.status() != null) {
            jdbc.update("UPDATE organizations SET status = ? WHERE id = ?", body.status().name(), id);
        }
        if (body.status() == OrganizationStatus.ARCHIVED) {
            jdbc.update("DELETE FROM membership_invitations WHERE organization_id = ?", id);
            if (Boolean.TRUE.equals(body.cancelFutureBookings())) {
                bookingService.cancelFuture(actor, BookingService.Scope.ORGANIZATION, id, true, "Organisasjonen er arkivert.");
            }
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

    private static final String ROOMS = """
            SELECT r.*, (SELECT count(*) FROM bookings b WHERE b.room_id = r.id) AS booking_count FROM rooms r
            """;

    @Transactional(readOnly = true)
    List<AdminRoom> listRooms() {
        Map<UUID, List<RoomAccessEntry>> access =
                accessByRoom("SELECT room_id, organization_id, permission FROM room_access");
        return jdbc.query(ROOMS + " ORDER BY r.status, lower(r.name)", (rs, i) -> toRoom(rs, access));
    }

    private AdminRoom room(UUID id) {
        Map<UUID, List<RoomAccessEntry>> access =
                accessByRoom("SELECT room_id, organization_id, permission FROM room_access WHERE room_id = ?", id);
        return jdbc.query(ROOMS + " WHERE r.id = ?", (rs, i) -> toRoom(rs, access), id)
                .stream().findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Rommet finnes ikke."));
    }

    private Map<UUID, List<RoomAccessEntry>> accessByRoom(String sql, Object... args) {
        return jdbc.query(sql, (rs, i) -> Map.entry(rs.getObject("room_id", UUID.class), new RoomAccessEntry(
                        rs.getObject("organization_id", UUID.class), Permission.valueOf(rs.getString("permission")))), args)
                .stream()
                .collect(Collectors.groupingBy(Map.Entry::getKey, Collectors.mapping(Map.Entry::getValue, Collectors.toList())));
    }

    private static AdminRoom toRoom(ResultSet rs, Map<UUID, List<RoomAccessEntry>> access) throws SQLException {
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
                new ArrayList<>(access.getOrDefault(id, List.of())),
                rs.getInt("booking_count"));
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

    /**
     * Disabling or archiving a room cancels its future bookings only with
     * {@code cancelFutureBookings: true}. Otherwise they stay, and the room just can't be booked.
     */
    @Transactional
    AdminRoom updateRoom(User actor, UUID id, RoomFields body) {
        room(id);
        String name = body.name().trim();
        requireUniqueRoomName(name, id);
        jdbc.update("""
                UPDATE rooms SET name = ?, description = ?, location = ?, capacity = ?, color = ?, default_permission = ?,
                    status = coalesce(?, status)
                WHERE id = ?
                """, name, blankToNull(body.description()), blankToNull(body.location()), body.capacity(), body.color(),
                body.defaultPermission().name(), body.status() == null ? null : body.status().name(), id);
        if (Boolean.TRUE.equals(body.cancelFutureBookings()) && body.status() != null && body.status() != RoomStatus.ACTIVE) {
            String reason = body.status() == RoomStatus.ARCHIVED ? "Rommet er arkivert." : "Rommet er stengt.";
            bookingService.cancelFuture(actor, BookingService.Scope.ROOM, id, true, reason);
        }
        return room(id);
    }

    /**
     * Deletes a room with its access rules. A room that has never had a booking (e.g. one created by
     * mistake) can be deleted directly. One with bookings, past and cancelled ones included, must be
     * archived first, and then its bookings are deleted with it. Booking writes lock the room row
     * first, so none can be added between the check and the delete.
     */
    @Transactional
    void deleteRoom(UUID id) {
        List<String> status = jdbc.queryForList("SELECT status FROM rooms WHERE id = ? FOR UPDATE", String.class, id);
        if (status.isEmpty()) throw new ApiException(ErrorCode.NOT_FOUND, "Rommet finnes ikke.");
        if (!status.getFirst().equals(RoomStatus.ARCHIVED.name()) && Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM bookings WHERE room_id = ?)", Boolean.class, id))) {
            throw new ApiException(ErrorCode.CONFLICT, "Rommet har bookinger. Arkiver det først, så kan det slettes.");
        }
        jdbc.update("DELETE FROM bookings WHERE room_id = ?", id);
        jdbc.update("DELETE FROM rooms WHERE id = ?", id);
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
