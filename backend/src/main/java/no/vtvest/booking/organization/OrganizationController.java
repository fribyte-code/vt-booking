package no.vtvest.booking.organization;

import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.security.CurrentUser;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class OrganizationController {

    record OrganizationResponse(UUID id, String name) {}

    private final OrganizationRepository organizations;
    private final CurrentUser currentUser;

    OrganizationController(OrganizationRepository organizations, CurrentUser currentUser) {
        this.organizations = organizations;
        this.currentUser = currentUser;
    }

    /** Directory of active organizations: names only, no members. */
    @GetMapping("/api/organizations")
    @Transactional(readOnly = true)
    List<OrganizationResponse> list() {
        currentUser.require();
        return organizations.findAll().stream()
                .filter(Organization::isActive)
                .sorted(Comparator.comparing(Organization::getName))
                .map(o -> new OrganizationResponse(o.getId(), o.getName()))
                .toList();
    }
}
