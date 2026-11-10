package no.vtvest.booking.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.organization.MembershipRole;
import no.vtvest.booking.organization.OrganizationStatus;
import no.vtvest.booking.room.OpeningHours;
import no.vtvest.booking.room.Permission;
import no.vtvest.booking.room.RoomStatus;
import no.vtvest.booking.user.GlobalRole;
import no.vtvest.booking.user.UserStatus;

/** Request and response bodies of the system administrator API. */
final class AdminDtos {

    private AdminDtos() {}

    // ── Users ──────────────────────────────────────────────────────

    record UserMembership(@NotNull UUID organizationId, @NotNull MembershipRole role) {}

    record AdminUser(
            UUID id,
            String email,
            String displayName,
            GlobalRole globalRole,
            UserStatus status,
            boolean hasPassword,
            boolean mustChangePassword,
            Instant lastLoginAt,
            List<UserMembership> memberships) {}

    record CreateUser(
            @NotBlank String email,
            @NotBlank String displayName,
            @NotNull GlobalRole globalRole,
            List<@NotNull @Valid UserMembership> memberships) {}

    /**
     * Null fields are left unchanged. Disabling a user always cancels their future pending
     * requests; {@code cancelFutureBookings: true} also cancels their future approved bookings.
     */
    record UpdateUser(
            String email, String displayName, GlobalRole globalRole, UserStatus status, Boolean cancelFutureBookings) {}

    /** The temporary password is only ever returned in this response. */
    record UserWithPassword(AdminUser user, String temporaryPassword) {}

    record TemporaryPassword(String temporaryPassword) {}

    record SetMembership(@NotNull MembershipRole role) {}

    // ── Organizations ──────────────────────────────────────────────

    record AdminOrganization(UUID id, String name, OrganizationStatus status, int memberCount) {}

    record CreateOrganization(@NotBlank @Size(max = 120) String name) {}

    /**
     * Null fields are left unchanged. Archiving deletes the organization's pending invitations;
     * its future bookings are cancelled only with {@code cancelFutureBookings: true}.
     */
    record UpdateOrganization(
            @Size(min = 1, max = 120) String name, OrganizationStatus status, Boolean cancelFutureBookings) {}

    // ── Rooms ──────────────────────────────────────────────────────

    record RoomAccessEntry(UUID organizationId, Permission permission) {}

    record AdminRoom(
            UUID id,
            String name,
            String description,
            String location,
            Integer capacity,
            String color,
            RoomStatus status,
            Permission defaultPermission,
            /** Per-organization overrides of the default. */
            List<RoomAccessEntry> access,
            /** All bookings in the room, past and cancelled ones included: what deleting it would remove. */
            int bookingCount,
            /** Offered in the public request form (/soknad). */
            boolean publicRequestable,
            /** Its ORG_ADMINs see, approve and reject the room's requests; null: system admins only (VT). */
            UUID managingOrganizationId,
            /** Empty: open around the clock (apart from 05:00–07:00). */
            List<OpeningHours.Entry> openingHours) {}

    record RoomFields(
            @NotBlank @Size(max = 80) String name,
            @Size(max = 1000) String description,
            @Size(max = 120) String location,
            @Min(1) @Max(10000) Integer capacity,
            @NotNull @Pattern(regexp = "^#[0-9a-fA-F]{6}$") String color,
            @NotNull Permission defaultPermission,
            /** Ignored on create (always ACTIVE). */
            RoomStatus status,
            /** With status DISABLED or ARCHIVED: also cancel the room's future bookings. Ignored otherwise. */
            Boolean cancelFutureBookings,
            /** Offered in the public request form. Null: false on create, unchanged on update. */
            Boolean publicRequestable,
            /** At most one per weekday. Null: none on create, unchanged on update. Empty: always open. */
            List<OpeningHours.Entry> openingHours,
            /** An active organization whose ORG_ADMINs manage the room's requests, or null for VT (system admins only). Always set as sent. */
            UUID managingOrganizationId) {}

    /** {@code permission: null} removes the override, so the room's default applies. */
    record SetRoomAccess(Permission permission) {}
}
