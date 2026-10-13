package no.vtvest.booking.organization;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.UUID;
import no.vtvest.booking.organization.OrgMemberService.AddedMember;
import no.vtvest.booking.organization.OrgMemberService.Member;
import no.vtvest.booking.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Members of one organization, managed by its ORG_ADMINs. */
@RestController
@RequestMapping("/api/organizations/{organizationId}/members")
class OrgMemberController {

    /** {@code displayName} is used only when a new account is created. There is no global role or password field. */
    record AddMember(@NotBlank String email, String displayName, @NotNull MembershipRole role) {}

    record SetRole(@NotNull MembershipRole role) {}

    private final OrgMemberService members;
    private final CurrentUser currentUser;

    OrgMemberController(OrgMemberService members, CurrentUser currentUser) {
        this.members = members;
        this.currentUser = currentUser;
    }

    @GetMapping
    List<Member> list(@PathVariable UUID organizationId) {
        return members.members(currentUser.require(), organizationId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    AddedMember add(@PathVariable UUID organizationId, @Valid @RequestBody AddMember body) {
        return members.add(currentUser.require(), organizationId, body.email(), body.displayName(), body.role());
    }

    @PutMapping("/{userId}")
    Member setRole(@PathVariable UUID organizationId, @PathVariable UUID userId, @Valid @RequestBody SetRole body) {
        return members.setRole(currentUser.require(), organizationId, userId, body.role());
    }

    @DeleteMapping("/{userId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void remove(@PathVariable UUID organizationId, @PathVariable UUID userId) {
        members.remove(currentUser.require(), organizationId, userId);
    }
}
