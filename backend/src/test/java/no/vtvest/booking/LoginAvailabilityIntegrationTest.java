package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import no.vtvest.booking.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Logins refused because the server can't check them now (all login slots busy, or the database
 * failing) get 503 and are not counted as failed logins: afterwards the right password works,
 * although more attempts were refused than the per-email limit allows.
 */
class LoginAvailabilityIntegrationTest extends IntegrationTest {

    /** More than LoginThrottle.MAX_FAILURES_PER_EMAIL (5). */
    private static final int ATTEMPTS = 6;
    /** LoginThrottle.MAX_CONCURRENT_LOGINS. */
    private static final int LOGIN_SLOTS = 8;

    @MockitoSpyBean
    UserRepository users;

    private ResultActions login(String password) throws Exception {
        return mvc.perform(post("/api/auth/login").with(withCsrf()).param("email", KARI_EMAIL).param("password", password));
    }

    @Test
    void loginsWithoutAFreeSlotGet503AndAreNotCounted() throws Exception {
        int taken = 0;
        try {
            for (; taken < LOGIN_SLOTS; taken++) {
                assertThat(loginThrottle.enterLogin()).isTrue();
            }
            assertThat(loginThrottle.enterLogin()).isFalse();
            for (int i = 0; i < ATTEMPTS; i++) {
                login("feil-" + i).andExpect(status().isServiceUnavailable());
            }
        } finally {
            for (int i = 0; i < taken; i++) {
                loginThrottle.leaveLogin();
            }
        }
        login(PASSWORD).andExpect(status().isNoContent());
    }

    @Test
    void loginsDuringADatabaseFailureGet503AndAreNotCounted() throws Exception {
        doThrow(new DataAccessResourceFailureException("database down")).when(users).findByEmailIgnoreCase(anyString());
        for (int i = 0; i < ATTEMPTS; i++) {
            login(PASSWORD).andExpect(status().isServiceUnavailable());
        }
        Mockito.reset(users);
        login(PASSWORD).andExpect(status().isNoContent());
    }
}
