package no.vtvest.booking.user;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import no.vtvest.booking.security.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
class MeController {

    record ChangePasswordRequest(@NotNull String currentPassword, @NotNull String newPassword) {}

    private final UserService userService;
    private final AccountService accountService;
    private final CurrentUser currentUser;

    MeController(UserService userService, AccountService accountService, CurrentUser currentUser) {
        this.userService = userService;
        this.accountService = accountService;
        this.currentUser = currentUser;
    }

    /** Works during a forced password change, so the SPA can show the change-password page. */
    @GetMapping("/api/me")
    MeResponse me() {
        return userService.me(currentUser.requireAllowingPasswordChange());
    }

    /**
     * Changes the user's own password. Ends the user's other sessions; this one stays logged in.
     * The only write allowed while a password change is required.
     */
    @PostMapping("/api/me/password")
    ResponseEntity<Void> changePassword(@Valid @RequestBody ChangePasswordRequest body, HttpServletRequest request) {
        Instant changedAt = accountService.changeOwnPassword(
                currentUser.requireAllowingPasswordChange(), body.currentPassword(), body.newPassword());
        CurrentUser.markSessionAuthenticated(request.getSession(), changedAt);
        return ResponseEntity.noContent().build();
    }
}
