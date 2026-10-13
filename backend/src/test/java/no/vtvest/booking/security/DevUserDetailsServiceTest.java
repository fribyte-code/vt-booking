package no.vtvest.booking.security;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import no.vtvest.booking.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.core.userdetails.UsernameNotFoundException;

/** The development login must never start outside the dev profile. */
class DevUserDetailsServiceTest {

    private final UserRepository users = mock(UserRepository.class);

    @Test
    void devAuthWithoutDevProfileFailsStartup() {
        MockEnvironment prod = new MockEnvironment();
        assertThatThrownBy(() -> new DevUserDetailsService(users, new DevAuthProperties(true, "dev"), prod))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("dev profile");
    }

    @Test
    void devAuthStartsWithDevProfile() {
        MockEnvironment dev = new MockEnvironment();
        dev.setActiveProfiles("dev");
        assertThatCode(() -> new DevUserDetailsService(users, new DevAuthProperties(true, "dev"), dev))
                .doesNotThrowAnyException();
    }

    @Test
    void disabledDevAuthRefusesEveryLogin() {
        DevUserDetailsService service =
                new DevUserDetailsService(users, new DevAuthProperties(false, null), new MockEnvironment());
        assertThatThrownBy(() -> service.loadUserByUsername("admin@example.no"))
                .isInstanceOf(UsernameNotFoundException.class);
    }
}
