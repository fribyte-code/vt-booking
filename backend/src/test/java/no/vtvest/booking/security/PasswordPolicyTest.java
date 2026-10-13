package no.vtvest.booking.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class PasswordPolicyTest {

    @Test
    void acceptsAnyPasswordAtLeastEightCharactersLong() {
        assertThat(PasswordPolicy.problem("korrekt hest batteri stift", "kari@example.test")).isEmpty();
        assertThat(PasswordPolicy.problem("password", null)).isEmpty();
        assertThat(PasswordPolicy.problem("aaaaaaaa", null)).isEmpty();
        assertThat(PasswordPolicy.problem("kari@example.test", " kari@example.test ")).isEmpty();
    }

    @Test
    void enforcesMinimumLengthInCharactersNotBytes() {
        assertThat(PasswordPolicy.problem("syvtegn", null)).hasValueSatisfying(m -> assertThat(m).contains("minst 8"));
        assertThat(PasswordPolicy.problem("æøåæøåæ", null)).isPresent();
        assertThat(PasswordPolicy.problem("æøåæøåæøå", null)).isEmpty();
    }
}
