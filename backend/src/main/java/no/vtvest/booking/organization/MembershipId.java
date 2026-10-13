package no.vtvest.booking.organization;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.UUID;

@Embeddable
public record MembershipId(
        @Column(name = "user_id") UUID userId,
        @Column(name = "organization_id") UUID organizationId) implements Serializable {}
