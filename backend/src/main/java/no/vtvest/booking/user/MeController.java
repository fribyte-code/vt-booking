package no.vtvest.booking.user;

import no.vtvest.booking.security.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class MeController {

    private final UserService userService;
    private final CurrentUser currentUser;

    MeController(UserService userService, CurrentUser currentUser) {
        this.userService = userService;
        this.currentUser = currentUser;
    }

    @GetMapping("/api/me")
    MeResponse me() {
        return userService.me(currentUser.require());
    }
}
