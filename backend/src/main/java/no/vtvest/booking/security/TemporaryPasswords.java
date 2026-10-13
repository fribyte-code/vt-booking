package no.vtvest.booking.security;

import java.security.SecureRandom;

/**
 * Server-generated temporary passwords, shown once to the administrator who created or reset
 * the account. 16 random characters from an alphabet without look-alikes (about 92 bits),
 * grouped for readability: "k7Qm-xR2p-...". The user must replace it at the next login.
 */
public final class TemporaryPasswords {

    private static final String ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private TemporaryPasswords() {}

    public static String generate() {
        while (true) {
            StringBuilder password = new StringBuilder(19);
            for (int i = 0; i < 16; i++) {
                if (i > 0 && i % 4 == 0) password.append('-');
                password.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
            }
            if (PasswordPolicy.problem(password.toString(), null).isEmpty()) {
                return password.toString();
            }
        }
    }
}
