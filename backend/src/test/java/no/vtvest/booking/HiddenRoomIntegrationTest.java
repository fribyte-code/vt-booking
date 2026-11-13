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

/**
 * Hidden rooms (Q-40, draft): Møterom A is hidden from those without access. In the fixtures
 * Organisasjon A and B book it directly and Organisasjon C has NONE, so Ingrid (only in C) loses
 * sight of it, while Kari (A), Ola (B), Jonas (A and C) and the system admin keep it.
 */
class HiddenRoomIntegrationTest extends IntegrationTest {

    private static final String INGRID = "20000000-0000-0000-0000-000000000003";
    private static final UUID ORG_C = UUID.fromString("10000000-0000-0000-0000-00000000000c");

    /** Kari's approved booking in Møterom A. */
    private UUID booking;

    @BeforeEach
    void setUp() throws Exception {
        String body = call(post("/api/bookings"), KARI, bookingJson(ROOM_A, ORG_A, "Styremøte", at(3, 10), at(3, 12)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andReturn().getResponse().getContentAsString();
        booking = UUID.fromString(JsonPath.read(body, "$.id"));
    }

    private void hideRoomA(boolean hidden, UUID managingOrganizationId) throws Exception {
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, """
                {"name":"Møterom A","color":"#2563eb","defaultPermission":"NONE","managingOrganizationId":%s,"hiddenWithoutAccess":%s}
                """.formatted(managingOrganizationId == null ? "null" : "\"" + managingOrganizationId + "\"", hidden))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hiddenWithoutAccess").value(hidden));
    }

    private List<String> roomIds(String actor) throws Exception {
        String body = call(get("/api/rooms"), actor, null).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$[*].id");
    }

    private List<String> calendarIds(String actor) throws Exception {
        String body = call(get("/api/bookings").param("from", at(0, 0).toString()).param("to", at(30, 0).toString()), actor, null)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$[*].id");
    }

    @Test
    void visibleToEveryoneByDefault() throws Exception {
        assertThat(roomIds(INGRID)).contains(ROOM_A.toString());
        assertThat(calendarIds(INGRID)).contains(booking.toString());
    }

    @Test
    void hiddenFromThoseWithoutAccess() throws Exception {
        hideRoomA(true, null);

        assertThat(roomIds(INGRID)).doesNotContain(ROOM_A.toString()).contains(ROOM_B.toString(), STORSALEN.toString());
        assertThat(calendarIds(INGRID)).doesNotContain(booking.toString());
        call(get("/api/bookings/" + booking), INGRID, null).andExpect(status().isNotFound());
        call(get("/api/bookings/" + booking + "/calendar.ics"), INGRID, null).andExpect(status().isNotFound());

        for (String withAccess : List.of(KARI, OLA, JONAS, ADMIN)) {
            assertThat(roomIds(withAccess)).as(withAccess).contains(ROOM_A.toString());
            assertThat(calendarIds(withAccess)).as(withAccess).contains(booking.toString());
        }
    }

    @Test
    void theManagersAlwaysSeeTheirRoom() throws Exception {
        jdbc.update("UPDATE memberships SET role = 'ORG_ADMIN' WHERE user_id = ?::uuid AND organization_id = ?", INGRID, ORG_C);
        hideRoomA(true, ORG_C);

        assertThat(roomIds(INGRID)).contains(ROOM_A.toString());
        assertThat(calendarIds(INGRID)).contains(booking.toString());
    }

    @Test
    void anOrganizationKeepsSeeingItsOwnBookingsAfterLosingAccess() throws Exception {
        call(put("/api/admin/rooms/" + ROOM_A + "/access/" + ORG_A), ADMIN, "{\"permission\":\"NONE\"}")
                .andExpect(status().isOk());
        hideRoomA(true, null);

        assertThat(roomIds(KARI)).doesNotContain(ROOM_A.toString());
        assertThat(calendarIds(KARI)).contains(booking.toString());
        call(get("/api/bookings/" + booking), KARI, null).andExpect(status().isOk());
    }

    @Test
    void anUpdateWithoutTheFieldKeepsIt() throws Exception {
        hideRoomA(true, null);
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, """
                {"name":"Møterom A","color":"#2563eb","defaultPermission":"NONE","managingOrganizationId":null}
                """).andExpect(status().isOk()).andExpect(jsonPath("$.hiddenWithoutAccess").value(true));
    }
}
