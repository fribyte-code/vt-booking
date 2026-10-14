package no.vtvest.booking.organization;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.user.User;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Invitations of existing accounts to an organization (see {@link OrgMemberService#add}). The
 * organization's admins see only the invited email, never the account's name or status. The
 * invited user accepts or declines after logging in.
 */
@Service
public class InvitationService {

    /** As seen by the organization's admins. */
    public record OrgInvitation(UUID id, String email, MembershipRole role, String invitedByName, Instant createdAt) {}

    /** As seen by the invited user. */
    public record MyInvitation(
            UUID id, UUID organizationId, String organizationName, MembershipRole role, String invitedByName, Instant createdAt) {}

    private final JdbcTemplate jdbc;
    private final OrgMemberService members;

    InvitationService(JdbcTemplate jdbc, OrgMemberService members) {
        this.jdbc = jdbc;
        this.members = members;
    }

    @Transactional(readOnly = true)
    public List<OrgInvitation> forOrganization(User actor, UUID organizationId) {
        members.requireOrgAdmin(actor, organizationId);
        return jdbc.query("""
                SELECT i.id, u.email, i.role, inviter.display_name AS invited_by_name, i.created_at
                FROM membership_invitations i
                JOIN users u ON u.id = i.user_id
                JOIN users inviter ON inviter.id = i.invited_by_id
                WHERE i.organization_id = ?
                ORDER BY i.created_at
                """, (rs, i) -> new OrgInvitation(
                rs.getObject("id", UUID.class), rs.getString("email"), MembershipRole.valueOf(rs.getString("role")),
                rs.getString("invited_by_name"), instant(rs.getTimestamp("created_at"))), organizationId);
    }

    @Transactional
    public void withdraw(User actor, UUID organizationId, UUID invitationId) {
        members.requireOrgAdmin(actor, organizationId);
        int deleted = jdbc.update("DELETE FROM membership_invitations WHERE id = ? AND organization_id = ?",
                invitationId, organizationId);
        if (deleted == 0) {
            throw notFound();
        }
    }

    /** The actor's own invitations to active organizations. */
    @Transactional(readOnly = true)
    public List<MyInvitation> mine(User actor) {
        return jdbc.query("""
                SELECT i.id, i.organization_id, o.name AS organization_name, i.role,
                       inviter.display_name AS invited_by_name, i.created_at
                FROM membership_invitations i
                JOIN organizations o ON o.id = i.organization_id
                JOIN users inviter ON inviter.id = i.invited_by_id
                WHERE i.user_id = ? AND o.status = 'ACTIVE'
                ORDER BY i.created_at
                """, (rs, i) -> new MyInvitation(
                rs.getObject("id", UUID.class), rs.getObject("organization_id", UUID.class),
                rs.getString("organization_name"), MembershipRole.valueOf(rs.getString("role")),
                rs.getString("invited_by_name"), instant(rs.getTimestamp("created_at"))), actor.getId());
    }

    /**
     * Joins the organization with the invited role and deletes the invitation. If the actor is a
     * member already (e.g. a SYSTEM_ADMIN added them meanwhile), the invitation is just deleted.
     * Another user's invitation is reported as not found.
     */
    @Transactional
    public void accept(User actor, UUID invitationId) {
        record Invitation(UUID organizationId, String role, String organizationStatus) {}
        Invitation invitation = jdbc.query("""
                SELECT i.organization_id, i.role, o.status
                FROM membership_invitations i JOIN organizations o ON o.id = i.organization_id
                WHERE i.id = ? AND i.user_id = ?
                FOR UPDATE OF i
                """, (rs, i) -> new Invitation(rs.getObject("organization_id", UUID.class), rs.getString("role"),
                rs.getString("status")), invitationId, actor.getId()).stream().findFirst().orElseThrow(InvitationService::notFound);
        if (!OrganizationStatus.ACTIVE.name().equals(invitation.organizationStatus())) {
            throw new ApiException(ErrorCode.INVALID_STATE, "Organisasjonen er arkivert.");
        }
        jdbc.update("""
                INSERT INTO memberships (user_id, organization_id, role) VALUES (?, ?, ?)
                ON CONFLICT (user_id, organization_id) DO NOTHING
                """, actor.getId(), invitation.organizationId(), invitation.role());
        jdbc.update("DELETE FROM membership_invitations WHERE id = ?", invitationId);
    }

    @Transactional
    public void decline(User actor, UUID invitationId) {
        int deleted = jdbc.update("DELETE FROM membership_invitations WHERE id = ? AND user_id = ?", invitationId, actor.getId());
        if (deleted == 0) {
            throw notFound();
        }
    }

    private static Instant instant(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    private static ApiException notFound() {
        return new ApiException(ErrorCode.NOT_FOUND, "Invitasjonen finnes ikke.");
    }
}
