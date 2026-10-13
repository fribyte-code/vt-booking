package no.vtvest.booking.security;

import jakarta.servlet.http.HttpSession;
import java.time.Instant;
import java.util.UUID;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.user.User;
import no.vtvest.booking.user.UserRepository;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Resolves the acting user from the authenticated session. The client never supplies it.
 * The session holds only the user ID; the user, role and status are loaded from the database
 * on every request, so a role change or a disabled account takes effect on the next request.
 *
 * A session also ends when the user's password changed after the session logged in (an
 * administrator reset it, or the user changed it in another session).
 */
@Component
public class CurrentUser {

    /** Session attribute: when this session logged in. Set by the login success handler. */
    public static final String AUTHENTICATED_AT = "vtbooking.authenticatedAt";

    private final UserRepository users;

    CurrentUser(UserRepository users) {
        this.users = users;
    }

    /** The acting user, who must not have a pending forced password change. */
    public User require() {
        User user = requireAllowingPasswordChange();
        if (user.isMustChangePassword()) {
            throw new ApiException(ErrorCode.PASSWORD_CHANGE_REQUIRED, "Du må bytte passord før du kan fortsette.");
        }
        return user;
    }

    /** The acting user, even if they must change their password first. Only for /api/me and the password change. */
    public User requireAllowingPasswordChange() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || auth instanceof AnonymousAuthenticationToken) {
            throw unauthenticated();
        }
        UUID id;
        try {
            id = UUID.fromString(auth.getName());
        } catch (IllegalArgumentException e) {
            throw unauthenticated();
        }
        User user = users.findById(id).filter(User::isActive).orElseThrow(CurrentUser::unauthenticated);
        Instant authenticatedAt = sessionAuthenticatedAt();
        if (authenticatedAt != null && user.getPasswordChangedAt() != null
                && user.getPasswordChangedAt().isAfter(authenticatedAt)) {
            throw unauthenticated();
        }
        return user;
    }

    /** Marks the current session as authenticated at the given instant (after the user's own password change). */
    public static void markSessionAuthenticated(HttpSession session, Instant at) {
        session.setAttribute(AUTHENTICATED_AT, at);
    }

    private static Instant sessionAuthenticatedAt() {
        if (!(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)) {
            return null;
        }
        HttpSession session = attributes.getRequest().getSession(false);
        return session == null ? null : (Instant) session.getAttribute(AUTHENTICATED_AT);
    }

    private static ApiException unauthenticated() {
        return new ApiException(ErrorCode.UNAUTHENTICATED, "Du må logge inn.");
    }
}
