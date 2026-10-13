package no.vtvest.booking.security;

import no.vtvest.booking.user.User;
import no.vtvest.booking.user.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.stereotype.Component;

/**
 * Looks up predefined users by email. Roles come from the database, never from the client.
 * When dev auth is disabled, nobody can log in. Defining this bean also stops Spring Boot
 * from creating its default in-memory user. Dev auth only starts with the "dev" profile, so
 * setting APP_DEV_AUTH_ENABLED alone (for example in a production environment) fails startup.
 */
@Component
class DevUserDetailsService implements UserDetailsService {

    private static final Logger log = LoggerFactory.getLogger(DevUserDetailsService.class);

    private final UserRepository users;
    private final boolean enabled;
    private final String encodedPassword;

    DevUserDetailsService(UserRepository users, DevAuthProperties properties, Environment environment) {
        this.users = users;
        this.enabled = properties.enabled();
        if (enabled) {
            if (!environment.acceptsProfiles(Profiles.of("dev"))) {
                throw new IllegalStateException("app.dev-auth.enabled requires the dev profile");
            }
            if (properties.password() == null || properties.password().isBlank()) {
                throw new IllegalStateException("app.dev-auth.password must be set when dev auth is enabled");
            }
            log.warn("Development login is ENABLED. Never use this configuration in production.");
            this.encodedPassword = PasswordEncoderFactories.createDelegatingPasswordEncoder()
                    .encode(properties.password());
        } else {
            this.encodedPassword = null;
        }
    }

    @Override
    public UserDetails loadUserByUsername(String email) {
        if (!enabled) {
            throw new UsernameNotFoundException("Login is disabled");
        }
        User user = users.findByEmailIgnoreCase(email)
                .orElseThrow(() -> new UsernameNotFoundException("Unknown user"));
        return org.springframework.security.core.userdetails.User.withUsername(user.getEmail())
                .password(encodedPassword)
                .roles(user.getGlobalRole().name())
                .build();
    }
}
