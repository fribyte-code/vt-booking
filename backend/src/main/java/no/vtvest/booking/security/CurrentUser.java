package no.vtvest.booking.security;

import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.user.User;
import no.vtvest.booking.user.UserRepository;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/** Resolves the acting user from the authenticated session. The client never supplies it. */
@Component
public class CurrentUser {

    private final UserRepository users;

    CurrentUser(UserRepository users) {
        this.users = users;
    }

    public User require() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || auth instanceof AnonymousAuthenticationToken) {
            throw new ApiException(ErrorCode.UNAUTHENTICATED, "Du må logge inn.");
        }
        return users.findByEmailIgnoreCase(auth.getName())
                .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHENTICATED, "Du må logge inn."));
    }
}
