package no.vtvest.booking.admin;

import static no.vtvest.booking.admin.AdminDtos.*;

import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.security.CurrentUser;
import no.vtvest.booking.user.User;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** System administrator API. Every method checks the SYSTEM_ADMIN role first. */
@RestController
@RequestMapping("/api/admin")
class AdminController {

    private final AdminService admin;
    private final CurrentUser currentUser;

    AdminController(AdminService admin, CurrentUser currentUser) {
        this.admin = admin;
        this.currentUser = currentUser;
    }

    private User requireAdmin() {
        User actor = currentUser.require();
        AdminService.requireSystemAdmin(actor);
        return actor;
    }

    // ── Users ──────────────────────────────────────────────────────

    @GetMapping("/users")
    List<AdminUser> users() {
        requireAdmin();
        return admin.listUsers();
    }

    /** Creates the user with a temporary password, returned once in this response. */
    @PostMapping("/users")
    @ResponseStatus(HttpStatus.CREATED)
    UserWithPassword createUser(@Valid @RequestBody CreateUser body) {
        requireAdmin();
        return admin.createUser(body);
    }

    @PatchMapping("/users/{id}")
    AdminUser updateUser(@PathVariable UUID id, @RequestBody UpdateUser body) {
        return admin.updateUser(requireAdmin(), id, body);
    }

    /** New temporary password, returned once. Ends all of the user's sessions. */
    @PostMapping("/users/{id}/reset-password")
    TemporaryPassword resetPassword(@PathVariable UUID id) {
        return admin.resetPassword(requireAdmin(), id);
    }

    @PutMapping("/users/{id}/memberships/{organizationId}")
    AdminUser setMembership(@PathVariable UUID id, @PathVariable UUID organizationId, @Valid @RequestBody SetMembership body) {
        requireAdmin();
        return admin.setMembership(id, organizationId, body.role());
    }

    @DeleteMapping("/users/{id}/memberships/{organizationId}")
    AdminUser removeMembership(@PathVariable UUID id, @PathVariable UUID organizationId) {
        requireAdmin();
        return admin.removeMembership(id, organizationId);
    }

    // ── Organizations ──────────────────────────────────────────────

    @GetMapping("/organizations")
    List<AdminOrganization> organizations() {
        requireAdmin();
        return admin.listOrganizations();
    }

    @PostMapping("/organizations")
    @ResponseStatus(HttpStatus.CREATED)
    AdminOrganization createOrganization(@Valid @RequestBody CreateOrganization body) {
        requireAdmin();
        return admin.createOrganization(body);
    }

    @PatchMapping("/organizations/{id}")
    AdminOrganization updateOrganization(@PathVariable UUID id, @Valid @RequestBody UpdateOrganization body) {
        requireAdmin();
        return admin.updateOrganization(id, body);
    }

    // ── Rooms ──────────────────────────────────────────────────────

    @GetMapping("/rooms")
    List<AdminRoom> rooms() {
        requireAdmin();
        return admin.listRooms();
    }

    @PostMapping("/rooms")
    @ResponseStatus(HttpStatus.CREATED)
    AdminRoom createRoom(@Valid @RequestBody RoomFields body) {
        requireAdmin();
        return admin.createRoom(body);
    }

    @PutMapping("/rooms/{id}")
    AdminRoom updateRoom(@PathVariable UUID id, @Valid @RequestBody RoomFields body) {
        requireAdmin();
        return admin.updateRoom(id, body);
    }

    @PutMapping("/rooms/{id}/access/{organizationId}")
    AdminRoom setRoomAccess(@PathVariable UUID id, @PathVariable UUID organizationId, @RequestBody SetRoomAccess body) {
        requireAdmin();
        return admin.setRoomAccess(id, organizationId, body.permission());
    }
}
