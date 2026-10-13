package no.vtvest.booking.security;

import java.util.Optional;

/**
 * Password rules: at least 8 characters. No composition rules or blacklist.
 * Used wherever a password is set.
 */
public final class PasswordPolicy {

    public static final int MIN_LENGTH = 8;

    private PasswordPolicy() {}

    /** Returns a Norwegian message describing what is wrong, or empty if the password is acceptable. */
    public static Optional<String> problem(String password, String email) {
        int length = password.codePointCount(0, password.length());
        if (length < MIN_LENGTH) {
            return Optional.of("Passordet må ha minst " + MIN_LENGTH + " tegn.");
        }
        return Optional.empty();
    }
}
