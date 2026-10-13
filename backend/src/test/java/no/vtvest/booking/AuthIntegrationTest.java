package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MvcResult;

/** The real login flow: CSRF cookie, form login, session cookie, logout. */
class AuthIntegrationTest extends IntegrationTest {

    private Cookie csrfCookie(MockHttpSession session) throws Exception {
        var request = get("/api/auth/csrf");
        if (session != null) request.session(session);
        // The token is written as a raw Set-Cookie header, which MockHttpServletResponse.getCookie() doesn't parse.
        String setCookie = mvc.perform(request).andExpect(status().isNoContent()).andReturn()
                .getResponse().getHeader("Set-Cookie");
        assertThat(setCookie).startsWith("XSRF-TOKEN=");
        return new Cookie("XSRF-TOKEN", setCookie.substring("XSRF-TOKEN=".length()).split(";")[0]);
    }

    @Test
    void loginRequiresCsrfAndValidCredentials() throws Exception {
        mvc.perform(post("/api/auth/login").param("email", KARI).param("password", "dev"))
                .andExpect(status().isForbidden());

        Cookie csrf = csrfCookie(null);
        mvc.perform(post("/api/auth/login")
                        .cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                        .param("email", KARI).param("password", "wrong"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/auth/login")
                        .cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                        .param("email", "nobody@example.no").param("password", "dev"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void sessionIdentifiesTheUserUntilLogout() throws Exception {
        Cookie csrf = csrfCookie(null);
        MvcResult login = mvc.perform(post("/api/auth/login")
                        .cookie(csrf).header("X-XSRF-TOKEN", csrf.getValue())
                        .param("email", KARI).param("password", "dev"))
                .andExpect(status().isNoContent())
                .andReturn();
        MockHttpSession session = (MockHttpSession) login.getRequest().getSession(false);
        assertThat(session).isNotNull();

        mvc.perform(get("/api/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(KARI))
                .andExpect(jsonPath("$.globalRole").value("USER"))
                .andExpect(jsonPath("$.memberships[0].organizationName").value("Organisasjon A"));

        // The CSRF token is rotated on login; fetch a fresh one for the logout POST.
        Cookie fresh = csrfCookie(session);
        mvc.perform(post("/api/auth/logout").session(session)
                        .cookie(fresh).header("X-XSRF-TOKEN", fresh.getValue()))
                .andExpect(status().isNoContent());
        assertThat(session.isInvalid()).isTrue();
    }
}
