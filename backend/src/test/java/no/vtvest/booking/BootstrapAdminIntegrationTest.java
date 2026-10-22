package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import no.vtvest.booking.bootstrap.BootstrapAdminService;
import no.vtvest.booking.bootstrap.BootstrapRefusedException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** Creating the first SYSTEM_ADMIN, and refusing whenever one already exists. */
class BootstrapAdminIntegrationTest extends IntegrationTest {

    private static final String NEW_PASSWORD = "første-admin-passord";

    @Autowired
    BootstrapAdminService bootstrap;

    /** A fresh installation: no administrator, and (for these tests) no other users either. */
    @BeforeEach
    void emptyInstallation() {
        jdbc.update("TRUNCATE bookings, memberships, users CASCADE");
    }

    @Test
    void createsAnActiveSystemAdminWhoCanLogIn() throws Exception {
        assertThat(bootstrap.adminExists()).isFalse();

        UUID id = bootstrap.createFirstAdmin(" VT-Admin@Example.test ", " Første Admin ", NEW_PASSWORD);

        assertThat(bootstrap.adminExists()).isTrue();
        var row = jdbc.queryForMap("SELECT email, display_name, global_role, status, password_hash FROM users WHERE id = ?", id);
        assertThat(row).containsEntry("email", "vt-admin@example.test")
                .containsEntry("display_name", "Første Admin")
                .containsEntry("global_role", "SYSTEM_ADMIN")
                .containsEntry("status", "ACTIVE");
        assertThat((String) row.get("password_hash")).startsWith("{argon2}$argon2id$").doesNotContain(NEW_PASSWORD);

        var csrf = new jakarta.servlet.http.Cookie("XSRF-TOKEN", "t");
        mvc.perform(post("/api/auth/login").cookie(csrf).header("X-XSRF-TOKEN", "t")
                        .param("email", "VT-ADMIN@example.test").param("password", NEW_PASSWORD))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/admin/users").with(user(id.toString())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].globalRole").value("SYSTEM_ADMIN"));
    }

    @Test
    void refusesOnceAnySystemAdminExists() {
        bootstrap.createFirstAdmin("a@example.test", "A", NEW_PASSWORD);
        assertThatThrownBy(() -> bootstrap.createFirstAdmin("b@example.test", "B", NEW_PASSWORD))
                .isInstanceOf(BootstrapRefusedException.class)
                .hasMessageContaining("allerede en systemadministrator");

        // A disabled administrator still counts: recovery is an operator task, not a bootstrap.
        jdbc.update("UPDATE users SET status = 'DISABLED'");
        assertThatThrownBy(() -> bootstrap.createFirstAdmin("b@example.test", "B", NEW_PASSWORD))
                .isInstanceOf(BootstrapRefusedException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isEqualTo(1);
    }

    @Test
    void neverTakesOverAnExistingAccount() {
        jdbc.update("INSERT INTO users (email, display_name) VALUES ('kari@example.test', 'Kari')");
        assertThatThrownBy(() -> bootstrap.createFirstAdmin("KARI@example.test", "Kari", NEW_PASSWORD))
                .isInstanceOf(BootstrapRefusedException.class)
                .hasMessageContaining("e-postadressen");
        assertThat(bootstrap.adminExists()).isFalse();
    }

    @Test
    void usesTheSameEmailAndNameRulesAsOtherAccounts() {
        assertThatThrownBy(() -> bootstrap.createFirstAdmin("ikke-en-epost", "A", NEW_PASSWORD))
                .isInstanceOf(BootstrapRefusedException.class)
                .hasMessage("Ugyldig e-postadresse.");
        assertThatThrownBy(() -> bootstrap.createFirstAdmin("vt-admin@example.test", " ", NEW_PASSWORD))
                .isInstanceOf(BootstrapRefusedException.class)
                .hasMessage("Navnet må ha 1 til 120 tegn.");
        assertThat(bootstrap.adminExists()).isFalse();
    }

    @Test
    void enforcesThePasswordPolicy() {
        for (String weak : new String[] {"kort", "syvtegn", "x".repeat(129)}) {
            assertThatThrownBy(() -> bootstrap.createFirstAdmin("vt-admin@example.test", "A", weak))
                    .isInstanceOf(BootstrapRefusedException.class);
        }
        bootstrap.createFirstAdmin("vt-admin@example.test", "A", "password");
        assertThat(bootstrap.adminExists()).isTrue();
    }

    @Test
    void concurrentRunsCreateExactlyOneAdmin() throws Exception {
        int runs = 6;
        ExecutorService pool = Executors.newFixedThreadPool(runs);
        try {
            List<Callable<Boolean>> tasks = new ArrayList<>();
            for (int i = 0; i < runs; i++) {
                String email = "admin" + i + "@example.test";
                tasks.add(() -> {
                    try {
                        bootstrap.createFirstAdmin(email, "Admin", NEW_PASSWORD);
                        return true;
                    } catch (BootstrapRefusedException e) {
                        return false;
                    }
                });
            }
            int created = 0;
            for (Future<Boolean> result : pool.invokeAll(tasks)) {
                if (result.get()) created++;
            }
            assertThat(created).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users WHERE global_role = 'SYSTEM_ADMIN'", Integer.class))
                .isEqualTo(1);
    }
}
