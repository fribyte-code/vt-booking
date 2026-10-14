package no.vtvest.booking.security;

import java.util.Optional;

/**
 * Password rules: 8 to 128 characters, counted as Unicode code points. No composition rules or
 * blocklist. The maximum keeps hashing cheap and is far above any passphrase people type.
 * Used wherever a password is set.
 */
public final class PasswordPolicy {

    public static final int MIN_LENGTH = 8;
    public static final int MAX_LENGTH = 128;

    private PasswordPolicy() {}

    /** Returns a Norwegian message describing what is wrong, or empty if the password is acceptable. */
    public static Optional<String> problem(String password) {
        int length = password.codePointCount(0, password.length());
        if (length < MIN_LENGTH) {
            return Optional.of("Passordet må ha minst " + MIN_LENGTH + " tegn.");
        }
        if (length > MAX_LENGTH) {
            return Optional.of("Passordet kan ha maks " + MAX_LENGTH + " tegn.");
        }
        return Optional.empty();
    }
}
