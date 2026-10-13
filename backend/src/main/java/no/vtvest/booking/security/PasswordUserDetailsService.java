package no.vtvest.booking.security;

import java.util.List;
import no.vtvest.booking.user.User;
import no.vtvest.booking.user.UserRepository;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Component;

/**
 * Looks up a user by email for password login. The returned principal's name is the user's
 * immutable ID, never the email, so the session keeps identifying the same user if the email
 * changes. Users that are not ACTIVE, or have no password, are reported as unknown: Spring then
 * runs a dummy hash so the response time and the generic 401 are the same as for a wrong password.
 * Authorities are deliberately empty; roles are read from the database on every request.
 */
@Component
class PasswordUserDetailsService implements UserDetailsService {

    private final UserRepository users;

    PasswordUserDetailsService(UserRepository users) {
        this.users = users;
    }

    @Override
    public UserDetails loadUserByUsername(String email) {
        User user = users.findByEmailIgnoreCase(email.trim())
                .filter(User::isActive)
                .orElseThrow(() -> new UsernameNotFoundException("Unknown or inactive user"));
        return org.springframework.security.core.userdetails.User.withUsername(user.getId().toString())
                .password(user.getPasswordHash())
                .authorities(List.of())
                .build();
    }
}
