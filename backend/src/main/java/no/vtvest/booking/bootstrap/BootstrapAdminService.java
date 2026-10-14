package no.vtvest.booking.bootstrap;

import java.util.UUID;
import no.vtvest.booking.security.PasswordPolicy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Creates the first SYSTEM_ADMIN. Only reachable from the bootstrap-admin command line
 * ({@link BootstrapAdminCli}); no controller calls it. It refuses as soon as any SYSTEM_ADMIN
 * exists, whatever their status, so it can never be used to take over a running system.
 */
@Service
public class BootstrapAdminService {

    /** Serializes concurrent bootstrap runs, so two of them can't both create an administrator. */
    private static final long LOCK_KEY = 0x5654_424f_4f54L; // "VTBOOT"

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;

    BootstrapAdminService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional(readOnly = true)
    public boolean adminExists() {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM users WHERE global_role = 'SYSTEM_ADMIN')", Boolean.class));
    }

    @Transactional(readOnly = true)
    public boolean emailInUse(String email) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(?))", Boolean.class, email.trim()));
    }

    /** Creates an ACTIVE SYSTEM_ADMIN with the given password, and returns the new user's ID. */
    @Transactional
    public UUID createFirstAdmin(String email, String displayName, String password) {
        jdbc.execute("SELECT pg_advisory_xact_lock(" + LOCK_KEY + ")");
        if (adminExists()) {
            throw new BootstrapRefusedException("Det finnes allerede en systemadministrator. Bootstrap kan bare brukes én gang.");
        }
        if (emailInUse(email)) {
            throw new BootstrapRefusedException("Det finnes allerede en bruker med denne e-postadressen.");
        }
        PasswordPolicy.problem(password).ifPresent(problem -> {
            throw new BootstrapRefusedException(problem);
        });
        return jdbc.queryForObject("""
                INSERT INTO users (email, display_name, global_role, status, password_hash, password_changed_at)
                VALUES (?, ?, 'SYSTEM_ADMIN', 'ACTIVE', ?, now())
                RETURNING id
                """, UUID.class, email.trim(), displayName.trim(), passwordEncoder.encode(password));
    }
}
