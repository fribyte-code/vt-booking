package no.vtvest.booking.user;

import java.util.List;
import java.util.UUID;
import no.vtvest.booking.organization.MembershipRole;

public record MeResponse(
        UUID id, String email, String displayName, GlobalRole globalRole, List<MembershipResponse> memberships) {

    public record MembershipResponse(UUID organizationId, String organizationName, MembershipRole role) {}
}
