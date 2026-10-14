package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
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
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Organization admins invite existing accounts instead of adding them, and learn nothing about
 * them; the invited user accepts or declines. Also: archived organizations are read-only for
 * their admins, and accounts created by an organization admin must change the temporary password.
 */
class InvitationIntegrationTest extends IntegrationTest {

    private static final String INGRID = "20000000-0000-0000-0000-000000000003"; // member of Organisasjon C
    private static final String ORG_A_MEMBERS = "/api/organizations/" + ORG_A + "/members";
    private static final String ORG_A_INVITATIONS = "/api/organizations/" + ORG_A + "/invitations";

    private ResultActions add(String actor, String email, String role) throws Exception {
        return call(post(ORG_A_MEMBERS), actor, "{\"email\":\"%s\",\"displayName\":\"Navn\",\"role\":\"%s\"}".formatted(email, role));
    }

    private int memberships(String userId) {
        return jdbc.queryForObject("SELECT count(*) FROM memberships WHERE user_id = ?::uuid AND organization_id = ?",
                Integer.class, userId, ORG_A);
    }

    private String invitationOf(String userId) {
        return jdbc.queryForObject("SELECT id::text FROM membership_invitations WHERE user_id = ?::uuid", String.class, userId);
    }

    @Test
    void invitingAnExistingAccountRevealsNothingAboutIt() throws Exception {
        jdbc.update("UPDATE users SET status = 'DISABLED' WHERE id = ?::uuid", INGRID);

        String active = add(JONAS, "ola@example.test", "MEMBER").andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String disabled = add(JONAS, "INGRID@example.test", "MEMBER").andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String systemAdmin = add(JONAS, "admin@example.test", "MEMBER").andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        assertThat(active).isEqualTo(disabled).isEqualTo(systemAdmin);
        assertThat((String) JsonPath.read(active, "$.result")).isEqualTo("INVITED");
        assertThat(active).doesNotContain("Ola", "Ingrid", "Silje", OLA, INGRID, ADMIN);
        assertThat(memberships(OLA) + memberships(INGRID) + memberships(ADMIN)).isZero();

        call(get(ORG_A_INVITATIONS), JONAS, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(3))
                .andExpect(jsonPath("$[0].email").value("ola@example.test"))
                .andExpect(jsonPath("$[0].invitedByName").value("Jonas Lie"))
                .andExpect(jsonPath("$[0].displayName").doesNotExist())
                .andExpect(jsonPath("$[0].status").doesNotExist())
                .andExpect(jsonPath("$[0].userId").doesNotExist());
    }

    @Test
    void invitingAgainUpdatesTheRoleAndMembersStillConflict() throws Exception {
        add(JONAS, "ola@example.test", "MEMBER").andExpect(status().isCreated());
        add(JONAS, "ola@example.test", "ORG_ADMIN").andExpect(status().isCreated());
        assertThat(jdbc.queryForObject("SELECT role FROM membership_invitations WHERE user_id = ?", String.class, OLA_ID))
                .isEqualTo("ORG_ADMIN");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM membership_invitations", Integer.class)).isEqualTo(1);

        add(JONAS, "kari@example.test", "MEMBER")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT"));
    }

    @Test
    void systemAdminsStillAddExistingAccountsDirectly() throws Exception {
        add(JONAS, "ola@example.test", "MEMBER").andExpect(status().isCreated());
        add(ADMIN, "ola@example.test", "MEMBER")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.result").value("ADDED"))
                .andExpect(jsonPath("$.member.userId").value(OLA))
                .andExpect(jsonPath("$.temporaryPassword").value(nullValue()));
        assertThat(memberships(OLA)).isEqualTo(1);
        // The membership settles the invitation.
        assertThat(jdbc.queryForObject("SELECT count(*) FROM membership_invitations", Integer.class)).isZero();
    }

    @Test
    void theInvitedUserAcceptsWithTheInvitedRole() throws Exception {
        add(JONAS, "ola@example.test", "ORG_ADMIN").andExpect(status().isCreated());
        String id = invitationOf(OLA);

        call(get("/api/me/invitations"), OLA, null)
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].organizationName").value("Organisasjon A"))
                .andExpect(jsonPath("$[0].role").value("ORG_ADMIN"))
                .andExpect(jsonPath("$[0].invitedByName").value("Jonas Lie"));
        call(get("/api/me/invitations"), KARI, null).andExpect(jsonPath("$.length()").value(0));

        // Nobody else can answer it.
        call(post("/api/me/invitations/" + id + "/accept"), KARI, null).andExpect(status().isNotFound());
        call(post("/api/me/invitations/" + id + "/decline"), KARI, null).andExpect(status().isNotFound());

        call(post("/api/me/invitations/" + id + "/accept"), OLA, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.memberships[?(@.organizationName == 'Organisasjon A')].role").value("ORG_ADMIN"));
        assertThat(jdbc.queryForObject("SELECT role FROM memberships WHERE user_id = ? AND organization_id = ?",
                String.class, OLA_ID, ORG_A)).isEqualTo("ORG_ADMIN");
        call(post("/api/me/invitations/" + id + "/accept"), OLA, null).andExpect(status().isNotFound());
    }

    @Test
    void declineAndWithdrawDeleteTheInvitation() throws Exception {
        add(JONAS, "ola@example.test", "MEMBER").andExpect(status().isCreated());
        call(post("/api/me/invitations/" + invitationOf(OLA) + "/decline"), OLA, null).andExpect(status().isNoContent());
        assertThat(memberships(OLA)).isZero();

        add(JONAS, "ola@example.test", "MEMBER").andExpect(status().isCreated());
        String id = invitationOf(OLA);
        call(delete(ORG_A_INVITATIONS + "/" + id), KARI, null).andExpect(status().isForbidden());
        call(delete("/api/organizations/10000000-0000-0000-0000-00000000000b/invitations/" + id), ADMIN, null)
                .andExpect(status().isNotFound());
        call(delete(ORG_A_INVITATIONS + "/" + id), JONAS, null).andExpect(status().isNoContent());
        call(delete(ORG_A_INVITATIONS + "/" + id), JONAS, null).andExpect(status().isNotFound());
        call(get("/api/me/invitations"), OLA, null).andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void onlyTheOrganizationsAdminsSeeItsInvitations() throws Exception {
        call(get(ORG_A_INVITATIONS), KARI, null).andExpect(status().isForbidden());
        call(get(ORG_A_INVITATIONS), OLA, null).andExpect(status().isForbidden());
        call(get(ORG_A_INVITATIONS), ADMIN, null).andExpect(status().isOk());
    }

    // ── Archived organizations ──────────────────────────────────────

    @Test
    void archivingDeletesInvitationsAndLocksOutOrgAdmins() throws Exception {
        add(JONAS, "ola@example.test", "MEMBER").andExpect(status().isCreated());
        call(patch("/api/admin/organizations/" + ORG_A), ADMIN, "{\"status\":\"ARCHIVED\"}").andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM membership_invitations", Integer.class)).isZero();

        call(get(ORG_A_MEMBERS), JONAS, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
        add(JONAS, "ny@example.test", "MEMBER").andExpect(status().isConflict());
        call(put(ORG_A_MEMBERS + "/" + KARI), JONAS, "{\"role\":\"ORG_ADMIN\"}").andExpect(status().isConflict());
        call(delete(ORG_A_MEMBERS + "/" + KARI), JONAS, null).andExpect(status().isConflict());
        call(get(ORG_A_INVITATIONS), JONAS, null).andExpect(status().isConflict());
        // Non-admins still get 403, and system admins can still manage it.
        call(get(ORG_A_MEMBERS), KARI, null).andExpect(status().isForbidden());
        call(get(ORG_A_MEMBERS), ADMIN, null).andExpect(status().isOk());
    }

    @Test
    void invitationsToAnArchivedOrganizationCannotBeAccepted() throws Exception {
        add(JONAS, "ola@example.test", "MEMBER").andExpect(status().isCreated());
        String id = invitationOf(OLA);
        jdbc.update("UPDATE organizations SET status = 'ARCHIVED' WHERE id = ?", ORG_A);

        call(get("/api/me/invitations"), OLA, null).andExpect(jsonPath("$.length()").value(0));
        call(post("/api/me/invitations/" + id + "/accept"), OLA, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_STATE"));
        assertThat(memberships(OLA)).isZero();
    }

    // ── Accounts created by an organization admin ──────────────────

    @Test
    void anAccountCreatedByAnOrgAdminMustChangeItsTemporaryPassword() throws Exception {
        String body = add(JONAS, "ny@example.test", "MEMBER")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.result").value("ADDED"))
                .andExpect(jsonPath("$.member.email").value("ny@example.test"))
                .andReturn().getResponse().getContentAsString();
        String temporary = JsonPath.read(body, "$.temporaryPassword");

        MockHttpSession session = (MockHttpSession) mvc.perform(post("/api/auth/login").with(withCsrf())
                        .param("email", "ny@example.test").param("password", temporary))
                .andExpect(status().isNoContent())
                .andReturn().getRequest().getSession(false);
        mvc.perform(get("/api/me").session(session)).andExpect(jsonPath("$.mustChangePassword").value(true));
        for (String path : new String[] {"/api/rooms", "/api/bookings/mine", "/api/me/invitations"}) {
            mvc.perform(get(path).session(session))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("PASSWORD_CHANGE_REQUIRED"));
        }
        mvc.perform(post("/api/bookings").session(session).with(withCsrf())
                        .contentType("application/json").content(bookingJson(ROOM_A, ORG_A, "X", at(7, 8), at(7, 9))))
                .andExpect(jsonPath("$.code").value("PASSWORD_CHANGE_REQUIRED"));

        mvc.perform(post("/api/me/password").session(session).with(withCsrf()).contentType("application/json")
                        .content("{\"currentPassword\":\"%s\",\"newPassword\":\"mitt-eget-passord\"}".formatted(temporary)))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/rooms").session(session)).andExpect(status().isOk());
    }

    @Test
    void unknownIdsAreNotFound() throws Exception {
        call(post("/api/me/invitations/" + UUID.randomUUID() + "/accept"), OLA, null).andExpect(status().isNotFound());
        call(get("/api/organizations/" + UUID.randomUUID() + "/invitations"), ADMIN, null).andExpect(status().isNotFound());
    }
}
