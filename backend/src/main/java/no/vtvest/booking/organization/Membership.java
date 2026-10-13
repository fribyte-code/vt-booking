package no.vtvest.booking.organization;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;

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
