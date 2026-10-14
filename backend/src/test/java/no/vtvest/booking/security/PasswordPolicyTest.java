package no.vtvest.booking.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class PasswordPolicyTest {

    @Test
    void acceptsAnyPasswordFromEightTo128Characters() {
        assertThat(PasswordPolicy.problem("korrekt hest batteri stift")).isEmpty();
        // No blocklist and no composition rules: common or repetitive passwords are allowed.
        assertThat(PasswordPolicy.problem("password")).isEmpty();
        assertThat(PasswordPolicy.problem("aaaaaaaa")).isEmpty();
        assertThat(PasswordPolicy.problem("kari@example.test")).isEmpty();
        assertThat(PasswordPolicy.problem("x".repeat(128))).isEmpty();
    }

    @Test
    void enforcesMinimumLengthInCharactersNotBytes() {
        assertThat(PasswordPolicy.problem("syvtegn")).hasValueSatisfying(m -> assertThat(m).contains("minst 8"));
        assertThat(PasswordPolicy.problem("æøåæøåæ")).isPresent();
        assertThat(PasswordPolicy.problem("æøåæøåæøå")).isEmpty();
    }

    @Test
    void enforcesMaximumLengthInCharactersNotBytes() {
        assertThat(PasswordPolicy.problem("x".repeat(129))).hasValueSatisfying(m -> assertThat(m).contains("maks 128"));
        // 128 two-byte characters are 256 bytes, but still 128 characters.
        assertThat(PasswordPolicy.problem("ø".repeat(128))).isEmpty();
        // Characters outside the BMP count once, not as two UTF-16 units.
        assertThat(PasswordPolicy.problem("😀".repeat(128))).isEmpty();
        assertThat(PasswordPolicy.problem("😀".repeat(129))).isPresent();
    }
}
