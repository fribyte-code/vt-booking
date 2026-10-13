package no.vtvest.booking.security;

import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
class PasswordConfig {

    /**
     * Argon2id with the OWASP minimum (19 MiB memory, 2 iterations, parallelism 1), 16-byte salt
     * and 32-byte hash. Hashes are stored with an {argon2} prefix, so the parameters or the
     * algorithm can be changed later without invalidating existing passwords.
     */
    @Bean
    PasswordEncoder passwordEncoder() {
        return new DelegatingPasswordEncoder(
                "argon2", Map.of("argon2", new Argon2PasswordEncoder(16, 32, 1, 19 * 1024, 2)));
    }
}
