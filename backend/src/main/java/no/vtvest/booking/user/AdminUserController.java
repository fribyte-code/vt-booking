package no.vtvest.booking.user;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.organization.Membership;
import no.vtvest.booking.organization.MembershipRepository;
import no.vtvest.booking.organization.MembershipRole;
import no.vtvest.booking.security.CurrentUser;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class AdminUserController {

    record AdminUserResponse(
            UUID id, String email, String displayName, GlobalRole globalRole, List<UserMembership> memberships) {}

    record UserMembership(UUID organizationId, MembershipRole role) {}

    private final UserRepository users;
    private final MembershipRepository memberships;
    private final CurrentUser currentUser;

    AdminUserController(UserRepository users, MembershipRepository memberships, CurrentUser currentUser) {
        this.users = users;
        this.memberships = memberships;
        this.currentUser = currentUser;
    }

    /** The user directory with memberships. Administrators only. */
    @GetMapping("/api/admin/users")
    @Transactional(readOnly = true)
    List<AdminUserResponse> list() {
        if (!currentUser.require().isAdmin()) {
            throw new ApiException(ErrorCode.FORBIDDEN, "Bare administratorer har tilgang.");
        }
        Map<UUID, List<UserMembership>> byUser = memberships.findAll().stream()
                .collect(Collectors.groupingBy(
                        m -> m.getId().userId(),
                        Collectors.mapping(
                                (Membership m) -> new UserMembership(m.getId().organizationId(), m.getRole()),
                                Collectors.toList())));
        return users.findAll().stream()
                .sorted(Comparator.comparing(User::getDisplayName))
                .map(u -> new AdminUserResponse(
                        u.getId(), u.getEmail(), u.getDisplayName(), u.getGlobalRole(), byUser.getOrDefault(u.getId(), List.of())))
                .toList();
    }
}
