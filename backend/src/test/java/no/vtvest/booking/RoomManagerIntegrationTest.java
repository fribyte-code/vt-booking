package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Room managers: the ORG_ADMINs of the organization a room is managed by see, approve and reject
 * its requests, and nothing more. Here Organisasjon C manages Storsalen (Ingrid is made its
 * ORG_ADMIN) and Organisasjon A manages Møterom B (Jonas is its ORG_ADMIN).
 */
class RoomManagerIntegrationTest extends IntegrationTest {

    private static final String INGRID = "20000000-0000-0000-0000-000000000003";
    private static final UUID ORG_C = UUID.fromString("10000000-0000-0000-0000-00000000000c");

    /** Ola's (Organisasjon B) request for Storsalen, managed by C. */
    private UUID inStorsalen;
    /** Kari's (Organisasjon A) request for Møterom B, managed by A. */
    private UUID inRoomB;

    @BeforeEach
    void setUp() throws Exception {
        jdbc.update("UPDATE memberships SET role = 'ORG_ADMIN' WHERE user_id = ?::uuid AND organization_id = ?", INGRID, ORG_C);
        setManager(STORSALEN, ORG_C);
        setManager(ROOM_B, ORG_A);
        inStorsalen = request(OLA, STORSALEN, ORG_B, 7);
        inRoomB = request(KARI, ROOM_B, ORG_A, 8);
    }

    private void setManager(UUID roomId, UUID organizationId) throws Exception {
        String name = jdbc.queryForObject("SELECT name FROM rooms WHERE id = ?", String.class, roomId);
        call(put("/api/admin/rooms/" + roomId), ADMIN, roomJson(name, organizationId)).andExpect(status().isOk());
    }

    private static String roomJson(String name, UUID organizationId) {
        return """
                {"name":"%s","color":"#7c3aed","defaultPermission":"REQUEST","managingOrganizationId":%s}
                """.formatted(name, organizationId == null ? "null" : "\"" + organizationId + "\"");
    }

    private UUID request(String actor, UUID roomId, UUID orgId, int days) throws Exception {
        String body = call(post("/api/bookings"), actor, bookingJson(roomId, orgId, "Søknad", at(days, 10), at(days, 12)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(JsonPath.read(body, "$.id"));
    }

    private ResultActions approve(String actor, UUID id) throws Exception {
        return call(post("/api/bookings/" + id + "/approve"), actor, "{\"version\":%d}".formatted(bookingVersion(id)));
    }

    private ResultActions reject(String actor, UUID id) throws Exception {
        return call(post("/api/bookings/" + id + "/reject"), actor,
                "{\"version\":%d,\"reason\":\"Opptatt\"}".formatted(bookingVersion(id)));
    }

    private List<String> queue(String actor) throws Exception {
        String body = call(get("/api/bookings/requests"), actor, null)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$[*].id");
    }

    private List<String> managedRoomIds(String actor) throws Exception {
        String body = call(get("/api/me"), actor, null).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(body).contains("\"managedRoomIds\"");
        return JsonPath.read(body, "$.managedRoomIds");
    }

    @Test
    void aManagerDecidesRequestsInTheirRoomButNotInOthers() throws Exception {
        approve(INGRID, inStorsalen)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.decidedByName").value("Ingrid Berg"));
        assertThat(jdbc.queryForObject("SELECT decided_by_id FROM bookings WHERE id = ?", String.class, inStorsalen))
                .isEqualTo(INGRID);

        approve(INGRID, inRoomB)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        reject(INGRID, inRoomB).andExpect(status().isForbidden());
        assertThat(jdbc.queryForObject("SELECT status FROM bookings WHERE id = ?", String.class, inRoomB)).isEqualTo("PENDING");

        // Rejecting in their own room works too, and is recorded.
        UUID another = request(KARI, STORSALEN, ORG_A, 9);
        reject(INGRID, another).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("REJECTED"));
        assertThat(jdbc.queryForObject("SELECT decided_by_id FROM bookings WHERE id = ?", String.class, another)).isEqualTo(INGRID);
    }

    @Test
    void ordinaryMembersCannotDecide() throws Exception {
        // Jonas is only a MEMBER of C, and Kari only a MEMBER of A.
        approve(JONAS, inStorsalen).andExpect(status().isForbidden());
        approve(KARI, inRoomB).andExpect(status().isForbidden());
        reject(KARI, inRoomB).andExpect(status().isForbidden());
        call(get("/api/bookings/requests"), KARI, null).andExpect(status().isForbidden());
        call(get("/api/bookings/requests"), OLA, null).andExpect(status().isForbidden());
    }

    @Test
    void managersOnlySeeTheirOwnRoomsRequests() throws Exception {
        assertThat(queue(INGRID)).containsExactly(inStorsalen.toString());
        assertThat(queue(JONAS)).containsExactly(inRoomB.toString());

        // The request in another room is not found, not even by id, for an ORG_ADMIN of another organization.
        call(get("/api/bookings/" + inStorsalen), JONAS, null).andExpect(status().isNotFound());
        call(get("/api/bookings/" + inRoomB), INGRID, null).andExpect(status().isNotFound());
        call(get("/api/bookings").param("from", at(0, 0).toString()).param("to", at(30, 0).toString()), JONAS, null)
                .andExpect(jsonPath("$[?(@.id == '" + inStorsalen + "')]").isEmpty());

        // In their own room they see the details they need to decide.
        call(get("/api/bookings/" + inStorsalen), INGRID, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requestedByName").value("Ola Hansen"))
                .andExpect(jsonPath("$.canDecide").value(true))
                .andExpect(jsonPath("$.ownOrganization").value(false));
        call(get("/api/bookings").param("from", at(0, 0).toString()).param("to", at(30, 0).toString()), INGRID, null)
                .andExpect(jsonPath("$[?(@.id == '" + inStorsalen + "')]").isNotEmpty());

        assertThat(managedRoomIds(INGRID)).containsExactly(STORSALEN.toString());
        assertThat(managedRoomIds(KARI)).isEmpty();
    }

    @Test
    void systemAdminsStillSeeAndDecideEverything() throws Exception {
        assertThat(queue(ADMIN)).contains(inStorsalen.toString(), inRoomB.toString());
        call(get("/api/bookings/" + inStorsalen), ADMIN, null).andExpect(jsonPath("$.canDecide").value(true));
        approve(ADMIN, inRoomB).andExpect(status().isOk());
        reject(ADMIN, inStorsalen).andExpect(status().isOk());
    }

    @Test
    void changingTheManagerMovesThePendingRequests() throws Exception {
        setManager(STORSALEN, ORG_A);

        assertThat(queue(JONAS)).containsExactlyInAnyOrder(inStorsalen.toString(), inRoomB.toString());
        call(get("/api/bookings/requests"), INGRID, null).andExpect(status().isForbidden());
        approve(INGRID, inStorsalen).andExpect(status().isForbidden());
        approve(JONAS, inStorsalen).andExpect(status().isOk());

        // Back to VT: system admins only.
        setManager(ROOM_B, null);
        approve(JONAS, inRoomB).andExpect(status().isForbidden());
        assertThat(managedRoomIds(JONAS)).containsExactly(STORSALEN.toString());
    }

    @Test
    void anArchivedOrganizationsAdminsLoseTheRights() throws Exception {
        jdbc.update("UPDATE organizations SET status = 'ARCHIVED' WHERE id = ?", ORG_C);
        approve(INGRID, inStorsalen).andExpect(status().isForbidden());
        // It can't be chosen as manager while archived, but a room keeping it can still be saved.
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, roomJson("Møterom A", ORG_C)).andExpect(status().isBadRequest());
        setManager(STORSALEN, ORG_C);
    }

    @Test
    void onlySystemAdminsChangeTheRoomSetup() throws Exception {
        call(put("/api/admin/rooms/" + STORSALEN), INGRID, roomJson("Storsalen", ORG_C)).andExpect(status().isForbidden());
        call(put("/api/admin/rooms/" + STORSALEN + "/access/" + ORG_B), INGRID, "{\"permission\":\"DIRECT\"}")
                .andExpect(status().isForbidden());
        call(get("/api/admin/rooms"), ADMIN, null)
                .andExpect(jsonPath("$[?(@.id == '" + STORSALEN + "')].managingOrganizationId").value(ORG_C.toString()));
        call(get("/api/rooms"), KARI, null)
                .andExpect(jsonPath("$[?(@.id == '" + STORSALEN + "')].managingOrganizationId").value(ORG_C.toString()));
        // Public requests stay with system admins.
        call(get("/api/admin/public-requests"), INGRID, null).andExpect(status().isForbidden());
    }

    @Test
    void seriesAreDecidedByTheManagersOfTheirRooms() throws Exception {
        String until = at(14, 10).atZone(java.time.ZoneId.of("Europe/Oslo")).toLocalDate().plusWeeks(1).toString();
        String body = call(post("/api/bookings/series"), OLA, """
                {"roomId":"%s","organizationId":"%s","title":"Ukentlig","start":"%s","end":"%s",
                 "recurrence":{"intervalWeeks":1,"until":"%s"},"skipConflicts":false}
                """.formatted(STORSALEN, ORG_B, at(14, 10), at(14, 11), until))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String seriesId = JsonPath.read(body, "$.seriesId");

        call(post("/api/bookings/series/" + seriesId + "/approve"), JONAS, "{}").andExpect(status().isForbidden());
        call(post("/api/bookings/series/" + seriesId + "/reject"), KARI, "{\"reason\":\"Nei\"}").andExpect(status().isForbidden());
        call(post("/api/bookings/series/" + seriesId + "/approve"), INGRID, "{}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.approved.length()").value(2));
        assertThat(jdbc.queryForList("SELECT DISTINCT decided_by_id::text FROM bookings WHERE series_id = ?::uuid", String.class, seriesId))
                .containsExactly(INGRID);
    }
}
