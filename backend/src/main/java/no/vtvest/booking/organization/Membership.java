package no.vtvest.booking.organization;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

/**
 * Written with JdbcTemplate by AdminService, OrgMemberService and InvitationService; JPA only reads
 * it. Not {@code @Immutable}: booking writes lock this row through JPA, and Hibernate refuses locks
 * on read-only entities.
 */
@Entity
@Table(name = "memberships")
public class Membership {

    @EmbeddedId
    private MembershipId id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MembershipRole role;

    protected Membership() {}

    public MembershipId getId() {
        return id;
    }

    public MembershipRole getRole() {
        return role;
    }
}
