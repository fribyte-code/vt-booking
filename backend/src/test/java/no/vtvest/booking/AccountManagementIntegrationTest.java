package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** Temporary passwords, the forced password change, and what system and organization admins may do. */
class AccountManagementIntegrationTest extends IntegrationTest {

    private static final String ORG_A_MEMBERS = "/api/organizations/10000000-0000-0000-0000-00000000000a/members";

    private ResultActions send(MockHttpServletRequestBuilder request, String actor, String json) throws Exception {
        request.with(withCsrf());
        if (actor != null) request.with(user(actor));
        if (json != null) request.contentType(MediaType.APPLICATION_JSON).content(json);
        return mvc.perform(request);
    }

    private MockHttpSession login(String email, String password) throws Exception {
        return (MockHttpSession) mvc.perform(post("/api/auth/login").with(withCsrf())
                        .param("email", email).param("password", password))
                .andExpect(status().isNoContent())
                .andReturn().getRequest().getSession(false);
    }

    private String createUser(String email) throws Exception {
        String body = send(post("/api/admin/users"), ADMIN, """
                {"email":"%s","displayName":"Ny Bruker","globalRole":"USER",
                 "memberships":[{"organizationId":"%s","role":"MEMBER"}]}
                """.formatted(email, ORG_A))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.user.mustChangePassword").value(true))
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.temporaryPassword");
    }

    @Test
    void newUserMustChangeTheTemporaryPasswordBeforeDoingAnythingElse() throws Exception {
        String temporary = createUser("ny@example.test");
        assertThat(temporary).matches("[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}");

        MockHttpSession session = login("ny@example.test", temporary);
        mvc.perform(get("/api/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mustChangePassword").value(true));
        mvc.perform(get("/api/rooms").session(session))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PASSWORD_CHANGE_REQUIRED"));

        mvc.perform(post("/api/me/password").session(session).with(withCsrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"%s\",\"newPassword\":\"kort\"}".formatted(temporary)))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/me/password").session(session).with(withCsrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"feil-passord-123\",\"newPassword\":\"mitt-eget-passord\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/me/password").session(session).with(withCsrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"%s\",\"newPassword\":\"mitt-eget-passord\"}".formatted(temporary)))
                .andExpect(status().isNoContent());

        // The session that changed the password stays logged in; the old password no longer works.
        mvc.perform(get("/api/rooms").session(session)).andExpect(status().isOk());
        mvc.perform(post("/api/auth/login").with(withCsrf()).param("email", "ny@example.test").param("password", temporary))
                .andExpect(status().isUnauthorized());
        login("ny@example.test", "mitt-eget-passord");
    }

    @Test
    void passwordChangeEndsTheUsersOtherSessions() throws Exception {
        MockHttpSession first = login(KARI_EMAIL, PASSWORD);
        MockHttpSession second = login(KARI_EMAIL, PASSWORD);
        mvc.perform(post("/api/me/password").session(second).with(withCsrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"%s\",\"newPassword\":\"helt-nytt-passord\"}".formatted(PASSWORD)))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/me").session(first)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me").session(second)).andExpect(status().isOk());
    }

    @Test
    void adminResetEndsSessionsAndForcesAChange() throws Exception {
        MockHttpSession kari = login(KARI_EMAIL, PASSWORD);
        String body = send(post("/api/admin/users/" + KARI + "/reset-password"), ADMIN, null)
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String temporary = JsonPath.read(body, "$.temporaryPassword");

        mvc.perform(get("/api/me").session(kari)).andExpect(status().isUnauthorized());
        MockHttpSession again = login(KARI_EMAIL, temporary);
        mvc.perform(get("/api/bookings/mine").session(again)).andExpect(status().isForbidden());

        // Admins can't reset their own password this way, and nobody else can reset at all.
        send(post("/api/admin/users/" + ADMIN + "/reset-password"), ADMIN, null).andExpect(status().isForbidden());
        send(post("/api/admin/users/" + OLA + "/reset-password"), JONAS, null).andExpect(status().isForbidden());
    }

    @Test
    void theLastActiveSystemAdminCannotBeRemoved() throws Exception {
        send(patch("/api/admin/users/" + ADMIN), ADMIN, "{\"globalRole\":\"USER\"}").andExpect(status().isForbidden());
        send(patch("/api/admin/users/" + ADMIN), ADMIN, "{\"status\":\"DISABLED\"}").andExpect(status().isForbidden());

        send(patch("/api/admin/users/" + KARI), ADMIN, "{\"globalRole\":\"SYSTEM_ADMIN\"}").andExpect(status().isOk());
        send(patch("/api/admin/users/" + ADMIN), KARI, "{\"globalRole\":\"USER\"}").andExpect(status().isOk());
        send(patch("/api/admin/users/" + KARI), KARI, "{\"globalRole\":\"USER\"}").andExpect(status().isForbidden());
    }

    @Test
    void onlySystemAdminsUseTheAdminApi() throws Exception {
        for (String actor : new String[] {KARI, JONAS}) {
            send(get("/api/admin/users"), actor, null).andExpect(status().isForbidden());
            send(post("/api/admin/rooms"), actor,
                    "{\"name\":\"X\",\"color\":\"#123456\",\"defaultPermission\":\"DIRECT\"}").andExpect(status().isForbidden());
            send(put("/api/admin/rooms/" + ROOM_A + "/access/" + ORG_A), actor, "{\"permission\":\"DIRECT\"}")
                    .andExpect(status().isForbidden());
            send(patch("/api/admin/users/" + actor), actor, "{\"globalRole\":\"SYSTEM_ADMIN\"}").andExpect(status().isForbidden());
        }
    }

    @Test
    void adminCreatesRoomsAndSetsAccess() throws Exception {
        String body = send(post("/api/admin/rooms"), ADMIN, """
                {"name":"Grupperom 1","capacity":6,"color":"#16a34a","defaultPermission":"REQUEST"}
                """).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String roomId = JsonPath.read(body, "$.id");
        send(put("/api/admin/rooms/" + roomId + "/access/" + ORG_A), ADMIN, "{\"permission\":\"DIRECT\"}")
                .andExpect(jsonPath("$.access[0].permission").value("DIRECT"));

        mvc.perform(get("/api/rooms").with(user(KARI)))
                .andExpect(jsonPath("$[?(@.name == 'Grupperom 1')].permissions[0].permission").value("DIRECT"));
        mvc.perform(get("/api/rooms").with(user(OLA)))
                .andExpect(jsonPath("$[?(@.name == 'Grupperom 1')].permissions[0].permission").value("REQUEST"));

        send(post("/api/admin/rooms"), ADMIN, "{\"name\":\"grupperom 1\",\"color\":\"#16a34a\",\"defaultPermission\":\"NONE\"}")
                .andExpect(status().isConflict());
    }

    @Test
    void orgAdminManagesOnlyTheirOwnOrganization() throws Exception {
        // Jonas is ORG_ADMIN of A and a plain member of C. Kari is a member of A.
        send(get(ORG_A_MEMBERS), JONAS, null).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2));
        send(get(ORG_A_MEMBERS), KARI, null).andExpect(status().isForbidden());
        send(get("/api/organizations/10000000-0000-0000-0000-00000000000c/members"), JONAS, null).andExpect(status().isForbidden());

        // New email: an account with a temporary password. Existing email: only the membership.
        send(post(ORG_A_MEMBERS), JONAS, "{\"email\":\"ny@example.test\",\"displayName\":\"Ny\",\"role\":\"MEMBER\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accountCreated").value(true))
                .andExpect(jsonPath("$.temporaryPassword").isString());
        send(post(ORG_A_MEMBERS), JONAS, "{\"email\":\"ola@example.test\",\"role\":\"MEMBER\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accountCreated").value(false))
                .andExpect(jsonPath("$.temporaryPassword").doesNotExist());
        // A globalRole in the body is ignored: the new account is an ordinary user.
        send(post(ORG_A_MEMBERS), JONAS, "{\"email\":\"sneaky@example.test\",\"displayName\":\"S\",\"role\":\"MEMBER\",\"globalRole\":\"SYSTEM_ADMIN\"}")
                .andExpect(status().isCreated());
        assertThat(jdbc.queryForObject("SELECT global_role FROM users WHERE email = 'sneaky@example.test'", String.class)).isEqualTo("USER");

        // Appoint another ORG_ADMIN, then step down; the last one can't.
        send(put(ORG_A_MEMBERS + "/" + KARI), JONAS, "{\"role\":\"ORG_ADMIN\"}").andExpect(jsonPath("$.role").value("ORG_ADMIN"));
        send(put(ORG_A_MEMBERS + "/" + JONAS), JONAS, "{\"role\":\"MEMBER\"}").andExpect(status().isOk());
        send(delete(ORG_A_MEMBERS + "/" + KARI), KARI, null).andExpect(status().isConflict());

        // A system admin's membership is off limits for org admins.
        jdbc.update("INSERT INTO memberships (user_id, organization_id) VALUES (?, ?)", ADMIN_ID, ORG_A);
        send(delete(ORG_A_MEMBERS + "/" + ADMIN), KARI, null).andExpect(status().isForbidden());
        send(delete(ORG_A_MEMBERS + "/" + OLA), KARI, null).andExpect(status().isNoContent());
    }

    @Test
    void repeatedFailedLoginsAreThrottled() throws Exception {
        for (int i = 0; i < 5; i++) {
            mvc.perform(post("/api/auth/login").with(withCsrf()).param("email", "ingrid@example.test").param("password", "feil-" + i))
                    .andExpect(status().isUnauthorized());
        }
        mvc.perform(post("/api/auth/login").with(withCsrf()).param("email", "INGRID@example.test").param("password", PASSWORD))
                .andExpect(status().isTooManyRequests());
        // Other accounts are not affected.
        login(KARI_EMAIL, PASSWORD);
    }

    @Test
    void sessionsAreNotKeptForUnknownIds() throws Exception {
        send(get("/api/me"), UUID.randomUUID().toString(), null).andExpect(status().isUnauthorized());
    }
}
