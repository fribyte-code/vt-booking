package no.vtvest.booking.user;

import java.util.List;
import java.util.UUID;
import no.vtvest.booking.organization.MembershipRole;

public record MeResponse(
        UUID id,
        String email,
        String displayName,
        GlobalRole globalRole,
        /** True after an administrator set a temporary password: every other endpoint returns 403 until it is changed. */
        boolean mustChangePassword,
        List<MembershipResponse> memberships) {

    public record MembershipResponse(UUID organizationId, String organizationName, MembershipRole role) {}
}
