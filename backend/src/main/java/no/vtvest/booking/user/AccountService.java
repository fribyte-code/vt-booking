package no.vtvest.booking.user;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;
import no.vtvest.booking.security.PasswordPolicy;
import no.vtvest.booking.security.TemporaryPasswords;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Creating accounts and setting passwords. Callers check who may do it; this class only does it.
 * Every password change sets password_changed_at, which ends all sessions that logged in earlier
 * (see CurrentUser).
 */
@Service
public class AccountService {

    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final Clock clock;

    AccountService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder, Clock clock) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.clock = clock;
    }

    /** A new account with a server-generated temporary password, which the user must change at first login. */
    public record CreatedAccount(UUID userId, String temporaryPassword) {}

    @Transactional
    public CreatedAccount createWithTemporaryPassword(String email, String displayName, GlobalRole role) {
        String normalizedEmail = normalizeEmail(email);
        String name = requireName(displayName);
        if (emailInUse(normalizedEmail, null)) {
            throw new ApiException(ErrorCode.CONFLICT, "Det finnes allerede en bruker med denne e-postadressen.");
        }
        String temporary = TemporaryPasswords.generate();
        UUID id = jdbc.queryForObject("""
                INSERT INTO users (email, display_name, global_role, status, password_hash, must_change_password, password_changed_at)
                VALUES (?, ?, ?, 'ACTIVE', ?, true, ?)
                RETURNING id
                """, UUID.class, normalizedEmail, name, role.name(), passwordEncoder.encode(temporary), Timestamp.from(now()));
        return new CreatedAccount(id, temporary);
    }

    /** Replaces the password with a new temporary one and ends all of the user's sessions. */
    @Transactional
    public String resetToTemporaryPassword(UUID userId) {
        String temporary = TemporaryPasswords.generate();
        jdbc.update("UPDATE users SET password_hash = ?, must_change_password = true, password_changed_at = ? WHERE id = ?",
                passwordEncoder.encode(temporary), Timestamp.from(now()), userId);
        return temporary;
    }

    /** Returns the instant of the change, so the caller can keep its own session valid. */
    @Transactional
    public Instant changeOwnPassword(User user, String currentPassword, String newPassword) {
        if (!passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            throw new ApiException(ErrorCode.VALIDATION, "Nåværende passord er feil.");
        }
        PasswordPolicy.problem(newPassword).ifPresent(problem -> {
            throw new ApiException(ErrorCode.VALIDATION, problem);
        });
        Instant changedAt = now();
        jdbc.update("UPDATE users SET password_hash = ?, must_change_password = false, password_changed_at = ? WHERE id = ?",
                passwordEncoder.encode(newPassword), Timestamp.from(changedAt), user.getId());
        return changedAt;
    }

    public boolean emailInUse(String email, UUID exceptUserId) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower(?) AND id IS DISTINCT FROM ?)",
                Boolean.class, email.trim(), exceptUserId));
    }

    public static String normalizeEmail(String email) {
        String value = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        if (value.length() > 254 || !EMAIL.matcher(value).matches()) {
            throw new ApiException(ErrorCode.VALIDATION, "Ugyldig e-postadresse.");
        }
        return value;
    }

    public static String requireName(String displayName) {
        String value = displayName == null ? "" : displayName.trim();
        if (value.isEmpty() || value.length() > 120 || value.chars().anyMatch(Character::isISOControl)) {
            throw new ApiException(ErrorCode.VALIDATION, "Navnet må ha 1 til 120 tegn.");
        }
        return value;
    }

    private Instant now() {
        return clock.instant().truncatedTo(ChronoUnit.MICROS);
    }
}
