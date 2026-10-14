package no.vtvest.booking.organization;

import java.util.List;
import java.util.UUID;
import no.vtvest.booking.booking.BookingService;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.user.AccountService;
import no.vtvest.booking.user.GlobalRole;
import no.vtvest.booking.user.User;
import no.vtvest.booking.user.UserStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Member management for one organization, by its ORG_ADMINs (or a SYSTEM_ADMIN).
 *
 * An ORG_ADMIN can add members, set MEMBER or ORG_ADMIN, and remove members, in active
 * organizations they administer only. A new email gets an account with a temporary password and
 * the membership at once; an existing account only gets an invitation that its owner accepts or
 * declines ({@link InvitationService}), so an ORG_ADMIN can't pull anyone into their organization or
 * learn anything about existing accounts. They cannot change anyone's email, status, global role or
 * password, cannot touch a SYSTEM_ADMIN's membership, and cannot remove or demote the
 * organization's last ORG_ADMIN.
 */
@Service
public class OrgMemberService {

    public record Member(UUID userId, String displayName, String email, MembershipRole role, UserStatus status) {}

    public enum AddResult {
        /** The membership exists now: a new account, or an existing one added by a SYSTEM_ADMIN. */
        ADDED,
        /** The email belongs to an existing account, which got an invitation. Nothing else is revealed. */
        INVITED
    }

    /**
     * ADDED: {@code member} is set, and {@code temporaryPassword} too when a new account was created
     * (returned only this once). INVITED: both are null, whatever the existing account looks like.
     */
    public record AddedMember(AddResult result, Member member, String temporaryPassword) {}

    private final JdbcTemplate jdbc;
    private final AccountService accounts;
    private final BookingService bookingService;

    OrgMemberService(JdbcTemplate jdbc, AccountService accounts, BookingService bookingService) {
        this.jdbc = jdbc;
        this.accounts = accounts;
        this.bookingService = bookingService;
    }

    /**
     * The organization exists and the actor may manage its members: a SYSTEM_ADMIN always, an
     * ORG_ADMIN of the organization only while it is active.
     */
    void requireOrgAdmin(User actor, UUID organizationId) {
        String status = jdbc.query("SELECT status FROM organizations WHERE id = ?",
                (rs, i) -> rs.getString("status"), organizationId).stream().findFirst().orElse(null);
        if (status == null) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Organisasjonen finnes ikke.");
        }
        if (actor.isSystemAdmin()) return;
        Boolean orgAdmin = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM memberships WHERE user_id = ? AND organization_id = ? AND role = 'ORG_ADMIN')
                """, Boolean.class, actor.getId(), organizationId);
        if (!Boolean.TRUE.equals(orgAdmin)) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bare organisasjonens administratorer kan administrere medlemmer.");
        }
        if (!OrganizationStatus.ACTIVE.name().equals(status)) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Organisasjonen er arkivert.");
        }
    }

    @Transactional(readOnly = true)
    public List<Member> members(User actor, UUID organizationId) {
        requireOrgAdmin(actor, organizationId);
        return jdbc.query("""
                SELECT u.id, u.display_name, u.email, m.role, u.status
                FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.organization_id = ?
                ORDER BY m.role DESC, lower(u.display_name)
                """, (rs, i) -> new Member(
                rs.getObject("id", UUID.class), rs.getString("display_name"), rs.getString("email"),
                MembershipRole.valueOf(rs.getString("role")), UserStatus.valueOf(rs.getString("status"))), organizationId);
    }

    @Transactional
    public AddedMember add(User actor, UUID organizationId, String email, String displayName, MembershipRole role) {
        requireOrgAdmin(actor, organizationId);
        String normalized = AccountService.normalizeEmail(email);
        UUID userId = jdbc.query("SELECT id FROM users WHERE lower(email) = lower(?)",
                (rs, i) -> rs.getObject("id", UUID.class), normalized).stream().findFirst().orElse(null);
        if (userId == null) {
            AccountService.CreatedAccount created =
                    accounts.createWithTemporaryPassword(normalized, displayName, GlobalRole.USER);
            insertMembership(created.userId(), organizationId, role);
            return new AddedMember(AddResult.ADDED, member(organizationId, created.userId()), created.temporaryPassword());
        }
        if (member(organizationId, userId) != null) {
            throw new ApiException(ErrorCode.CONFLICT, "Brukeren er allerede medlem av organisasjonen.");
        }
        if (actor.isSystemAdmin()) {
            insertMembership(userId, organizationId, role);
            jdbc.update("DELETE FROM membership_invitations WHERE user_id = ? AND organization_id = ?", userId, organizationId);
            return new AddedMember(AddResult.ADDED, member(organizationId, userId), null);
        }
        // Same response whatever the account's status or role: inviting reveals nothing about it.
        jdbc.update("""
                INSERT INTO membership_invitations (organization_id, user_id, role, invited_by_id) VALUES (?, ?, ?, ?)
                ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, invited_by_id = EXCLUDED.invited_by_id
                """, organizationId, userId, role.name(), actor.getId());
        return new AddedMember(AddResult.INVITED, null, null);
    }

    private void insertMembership(UUID userId, UUID organizationId, MembershipRole role) {
        jdbc.update("INSERT INTO memberships (user_id, organization_id, role) VALUES (?, ?, ?)",
                userId, organizationId, role.name());
    }

    @Transactional
    public Member setRole(User actor, UUID organizationId, UUID userId, MembershipRole role) {
        requireOrgAdmin(actor, organizationId);
        Member target = requireChangeable(actor, organizationId, userId);
        if (target.role() == MembershipRole.ORG_ADMIN && role != MembershipRole.ORG_ADMIN) {
            requireAnotherOrgAdmin(actor, organizationId, userId);
        }
        jdbc.update("UPDATE memberships SET role = ? WHERE user_id = ? AND organization_id = ?", role.name(), userId, organizationId);
        return member(organizationId, userId);
    }

    @Transactional
    public void remove(User actor, UUID organizationId, UUID userId) {
        requireOrgAdmin(actor, organizationId);
        Member target = requireChangeable(actor, organizationId, userId);
        if (target.role() == MembershipRole.ORG_ADMIN) {
            requireAnotherOrgAdmin(actor, organizationId, userId);
        }
        jdbc.update("DELETE FROM memberships WHERE user_id = ? AND organization_id = ?", userId, organizationId);
        // Their pending requests for the organization can no longer be approved. Approved bookings stay.
        bookingService.cancelFutureRequestsOfFormerMember(actor, userId, organizationId);
    }

    private Member requireChangeable(User actor, UUID organizationId, UUID userId) {
        Member target = member(organizationId, userId);
        if (target == null) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Brukeren er ikke medlem av organisasjonen.");
        }
        if (!actor.isSystemAdmin() && Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT global_role = 'SYSTEM_ADMIN' FROM users WHERE id = ?", Boolean.class, userId))) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bare systemadministratorer kan endre en systemadministrators medlemskap.");
        }
        return target;
    }

    /** An organization keeps at least one ORG_ADMIN, unless a SYSTEM_ADMIN decides otherwise. */
    private void requireAnotherOrgAdmin(User actor, UUID organizationId, UUID userId) {
        if (actor.isSystemAdmin()) return;
        // Lock the organization's memberships so two admins can't demote each other at once.
        jdbc.query("SELECT 1 FROM memberships WHERE organization_id = ? FOR UPDATE", (rs, i) -> 1, organizationId);
        Integer others = jdbc.queryForObject("""
                SELECT count(*) FROM memberships WHERE organization_id = ? AND role = 'ORG_ADMIN' AND user_id <> ?
                """, Integer.class, organizationId, userId);
        if (others == null || others == 0) {
            throw new ApiException(ErrorCode.CONFLICT, "Organisasjonen må ha minst én administrator.");
        }
    }

    private Member member(UUID organizationId, UUID userId) {
        return jdbc.query("""
                SELECT u.id, u.display_name, u.email, m.role, u.status
                FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.organization_id = ? AND m.user_id = ?
                """, (rs, i) -> new Member(
                rs.getObject("id", UUID.class), rs.getString("display_name"), rs.getString("email"),
                MembershipRole.valueOf(rs.getString("role")), UserStatus.valueOf(rs.getString("status"))),
                organizationId, userId).stream().findFirst().orElse(null);
    }
}
