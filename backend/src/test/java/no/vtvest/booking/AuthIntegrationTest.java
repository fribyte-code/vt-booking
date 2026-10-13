package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/** The real login flow: CSRF cookie, email and password, session cookie, logout. */
class AuthIntegrationTest extends IntegrationTest {

    @Autowired
    PasswordEncoder passwordEncoder;

    @Autowired
    RequestMappingHandlerMapping handlerMapping;

    private Cookie csrfCookie(MockHttpSession session) throws Exception {
        var request = get("/api/auth/csrf");
        if (session != null) request.session(session);
        // The token is written as a raw Set-Cookie header, which MockHttpServletResponse.getCookie() doesn't parse.
        String setCookie = mvc.perform(request).andExpect(status().isNoContent()).andReturn()
                .getResponse().getHeader("Set-Cookie");
        assertThat(setCookie).startsWith("XSRF-TOKEN=");
        return new Cookie("XSRF-TOKEN", setCookie.substring("XSRF-TOKEN=".length()).split(";")[0]);
    }

    private ResultActions login(MockHttpSession session, String email, String password) throws Exception {
        Cookie csrf = csrfCookie(session);
        var request = post("/api/auth/login")
                .cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                .param("email", email).param("password", password);
        if (session != null) request.session(session);
        return mvc.perform(request);
    }

    private MockHttpSession loggedIn(String email, String password) throws Exception {
        MockHttpSession session = (MockHttpSession) login(null, email, password)
                .andExpect(status().isNoContent())
                .andReturn().getRequest().getSession(false);
        assertThat(session).isNotNull();
        return session;
    }

    @Test
    void loginRequiresCsrf() throws Exception {
        mvc.perform(post("/api/auth/login").param("email", KARI_EMAIL).param("password", PASSWORD))
                .andExpect(status().isForbidden());
    }

    @Test
    void everyFailedLoginGetsTheSameBodilessResponse() throws Exception {
        jdbc.update("""
                INSERT INTO users (email, display_name) VALUES ('nopassword@example.test', 'Uten passord')
                """);
        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?", OLA_ID);

        String[][] attempts = {
            {KARI_EMAIL, "feil-passord-123"}, // wrong password
            {"nobody@example.test", PASSWORD}, // unknown email
            {"nopassword@example.test", PASSWORD}, // no password set
            {"ola@example.test", PASSWORD}, // correct password, but disabled
            {KARI_EMAIL, ""},
        };
        for (String[] attempt : attempts) {
            login(null, attempt[0], attempt[1])
                    .andExpect(status().isUnauthorized())
                    .andExpect(content().string(""));
        }
    }

    @Test
    void loginIsCaseInsensitiveOnEmailAndRecordsTheLoginTime() throws Exception {
        Instant before = Instant.now().minusSeconds(1);
        loggedIn("  KARI@Example.Test ", PASSWORD);
        Instant lastLogin = jdbc.queryForObject("SELECT last_login_at FROM users WHERE id = ?", Instant.class, KARI_ID);
        assertThat(lastLogin).isAfter(before);
    }

    @Test
    void sessionIdentifiesTheUserByIdUntilLogout() throws Exception {
        MockHttpSession session = loggedIn(KARI_EMAIL, PASSWORD);

        mvc.perform(get("/api/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(KARI))
                .andExpect(jsonPath("$.email").value(KARI_EMAIL))
                .andExpect(jsonPath("$.globalRole").value("USER"))
                .andExpect(jsonPath("$.memberships[0].organizationName").value("Organisasjon A"));

        // The session holds the user ID, not the email: changing the email keeps the same user.
        jdbc.update("UPDATE users SET email = 'kari.ny@example.test' WHERE id = ?", KARI_ID);
        mvc.perform(get("/api/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(KARI))
                .andExpect(jsonPath("$.email").value("kari.ny@example.test"));

        // The CSRF token is rotated on login; fetch a fresh one for the logout POST.
        Cookie fresh = csrfCookie(session);
        mvc.perform(post("/api/auth/logout").session(session)
                        .cookie(fresh).header("X-XSRF-TOKEN", fresh.getValue()))
                .andExpect(status().isNoContent());
        assertThat(session.isInvalid()).isTrue();
    }

    @Test
    void sessionIdChangesOnLogin() throws Exception {
        MockHttpSession session = new MockHttpSession();
        String before = session.getId();
        login(session, KARI_EMAIL, PASSWORD).andExpect(status().isNoContent());
        assertThat(session.getId()).isNotEqualTo(before);
    }

    @Test
    void disablingAUserEndsAccessOnTheNextRequest() throws Exception {
        MockHttpSession session = loggedIn(KARI_EMAIL, PASSWORD);
        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?", KARI_ID);
        mvc.perform(get("/api/me").session(session)).andExpect(status().isUnauthorized());
    }

    @Test
    void roleChangesTakeEffectWithoutLoggingInAgain() throws Exception {
        MockHttpSession session = loggedIn(ADMIN_EMAIL, PASSWORD);
        mvc.perform(get("/api/admin/users").session(session)).andExpect(status().isOk());
        jdbc.update("UPDATE users SET global_role = 'USER' WHERE id = ?", ADMIN_ID);
        mvc.perform(get("/api/admin/users").session(session)).andExpect(status().isForbidden());
    }

    @Test
    void passwordsAreStoredAsArgon2idHashes() throws Exception {
        String hash = passwordEncoder.encode("et-langt-passord-42");
        assertThat(hash).startsWith("{argon2}$argon2id$v=19$m=19456,t=2,p=1$");
        assertThat(passwordEncoder.matches("et-langt-passord-42", hash)).isTrue();
        assertThat(passwordEncoder.matches("et-langt-passord-43", hash)).isFalse();

        jdbc.update("UPDATE users SET password_hash = ? WHERE id = ?", hash, KARI_ID);
        loggedIn(KARI_EMAIL, "et-langt-passord-42");
        login(null, KARI_EMAIL, PASSWORD).andExpect(status().isUnauthorized());
    }

    @Test
    void withoutASessionEverythingButTheCsrfEndpointIsClosed() throws Exception {
        for (String path : new String[] {"/api/me", "/api/rooms", "/api/organizations", "/api/bookings/mine", "/api/admin/users"}) {
            mvc.perform(get(path)).andExpect(status().isUnauthorized());
        }
    }

    @Test
    void noBootstrapOrDevelopmentLoginIsReachableOverHttp() throws Exception {
        assertThat(handlerMapping.getHandlerMethods().keySet())
                .flatExtracting(info -> info.getPatternValues())
                .allSatisfy(path -> assertThat(path).doesNotContainIgnoringCase("bootstrap").doesNotContainIgnoringCase("dev"));
        mvc.perform(post("/api/bootstrap-admin")).andExpect(status().isForbidden()); // no CSRF token
        mvc.perform(get("/api/bootstrap-admin")).andExpect(status().isUnauthorized());
    }
}
