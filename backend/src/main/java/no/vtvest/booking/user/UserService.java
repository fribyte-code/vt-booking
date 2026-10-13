package no.vtvest.booking.user;

import java.util.Comparator;
import java.util.List;
import no.vtvest.booking.organization.MembershipRepository;
import no.vtvest.booking.organization.OrganizationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    private final MembershipRepository memberships;
    private final OrganizationRepository organizations;

    UserService(MembershipRepository memberships, OrganizationRepository organizations) {
        this.memberships = memberships;
        this.organizations = organizations;
    }

    @Transactional(readOnly = true)
    public MeResponse me(User actor) {
        List<MeResponse.MembershipResponse> mine = memberships.findByIdUserId(actor.getId()).stream()
                .map(m -> new MeResponse.MembershipResponse(
                        m.getId().organizationId(),
                        organizations.getReferenceById(m.getId().organizationId()).getName(),
                        m.getRole()))
                .sorted(Comparator.comparing(MeResponse.MembershipResponse::organizationName))
                .toList();
        return new MeResponse(actor.getId(), actor.getEmail(), actor.getDisplayName(), actor.getGlobalRole(), mine);
    }
}
