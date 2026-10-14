package no.vtvest.booking.organization;

import java.util.List;
import java.util.UUID;
import no.vtvest.booking.organization.InvitationService.MyInvitation;
import no.vtvest.booking.organization.InvitationService.OrgInvitation;
import no.vtvest.booking.security.CurrentUser;
import no.vtvest.booking.user.MeResponse;
import no.vtvest.booking.user.User;
import no.vtvest.booking.user.UserService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Membership invitations: managed by the organization's admins, answered by the invited user. */
@RestController
class InvitationController {

    private final InvitationService invitations;
    private final UserService userService;
    private final CurrentUser currentUser;

    InvitationController(InvitationService invitations, UserService userService, CurrentUser currentUser) {
        this.invitations = invitations;
        this.userService = userService;
        this.currentUser = currentUser;
    }

    @GetMapping("/api/organizations/{organizationId}/invitations")
    List<OrgInvitation> forOrganization(@PathVariable UUID organizationId) {
        return invitations.forOrganization(currentUser.require(), organizationId);
    }

    @DeleteMapping("/api/organizations/{organizationId}/invitations/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void withdraw(@PathVariable UUID organizationId, @PathVariable UUID id) {
        invitations.withdraw(currentUser.require(), organizationId, id);
    }

    @GetMapping("/api/me/invitations")
    List<MyInvitation> mine() {
        return invitations.mine(currentUser.require());
    }

    /** Returns the updated /api/me, with the new membership. */
    @PostMapping("/api/me/invitations/{id}/accept")
    MeResponse accept(@PathVariable UUID id) {
        User actor = currentUser.require();
        invitations.accept(actor, id);
        return userService.me(actor);
    }

    @PostMapping("/api/me/invitations/{id}/decline")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void decline(@PathVariable UUID id) {
        invitations.decline(currentUser.require(), id);
    }
}
