package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/**
 * A public request and the booking made from it: the booking is the truth for time and room, an
 * edit of the request updates the booking with all the booking rules (or saves nothing), and a
 * booking that goes away releases the request (V11).
 */
class PublicRequestBookingSyncIntegrationTest extends IntegrationTest {

    private static final UUID ORG_C = UUID.fromString("10000000-0000-0000-0000-00000000000c");

    private static final String CONTACT =
            "{\"name\":\"Kari Nordmann\",\"organization\":\"Ekstern forening\",\"cardNumber\":\"12345678\",\"phone\":\"+4791234567\"}";

    @BeforeEach
    void offerStorsalen() {
        jdbc.update("UPDATE rooms SET public_requestable = true WHERE id = ?", STORSALEN);
    }

    private static String requestJson(Instant start, Instant end) {
        return """
                {"email":"leder@example.test","organizationName":"Ekstern forening","eventName":"Hagekonsert","memberOfKulturstyretOrSamfunnet":true,
                 "preferredRoomId":"%s","start":"%s","end":"%s","description":"Konsert i hagen","contacts":[%s]}
                """.formatted(STORSALEN, start, end, CONTACT);
    }

    private static String editJson(String eventName, UUID roomId, Instant start, Instant end, String description, String contact) {
        return """
                {"email":"leder@example.test","organizationName":"Ekstern forening","eventName":"%s","memberOfKulturstyretOrSamfunnet":true,
                 "preferredRoomId":%s,"start":"%s","end":"%s","description":"%s","contacts":[%s]}
                """.formatted(eventName, roomId == null ? "null" : "\"" + roomId + "\"", start, end, description, contact);
    }

    /** Sends a request from the form and books it for Organisasjon C in room B (DIRECT), 18–20 UTC in a week. */
    private UUID[] requestWithBooking() throws Exception {
        mvc.perform(post("/api/public/requests").with(withCsrf())
                        .contentType(MediaType.APPLICATION_JSON).content(requestJson(at(7, 18), at(7, 20))))
                .andExpect(status().isNoContent());
        UUID id = jdbc.queryForObject("SELECT id FROM public_requests ORDER BY created_at DESC LIMIT 1", UUID.class);
        String body = call(post("/api/admin/public-requests/" + id + "/booking"), ADMIN,
                        bookingJson(ROOM_B, ORG_C, "Hagekonsert", at(7, 18), at(7, 20)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return new UUID[] {id, UUID.fromString(JsonPath.read(body, "$.id"))};
    }

    private String request(UUID id, String path) throws Exception {
        String body = call(get("/api/admin/public-requests"), ADMIN, null).andReturn().getResponse().getContentAsString();
        Object value = JsonPath.read(body, "$[?(@.id == '" + id + "')]" + path);
        return String.valueOf(((java.util.List<?>) value).getFirst());
    }

    private Instant bookingStart(UUID bookingId) {
        return jdbc.queryForObject("SELECT start_at FROM bookings WHERE id = ?", Timestamp.class, bookingId).toInstant();
    }

    @Test
    void theListShowsTheLinkedBookingLiveAfterAMoveInTheCalendar() throws Exception {
        UUID[] ids = requestWithBooking();

        // Moved in the calendar: nothing is written to the request, which reads the booking.
        call(put("/api/bookings/" + ids[1]), ADMIN, """
                {"version":%d,"roomId":"%s","title":"Hagekonsert","start":"%s","end":"%s"}
                """.formatted(bookingVersion(ids[1]), ROOM_B, at(7, 19), at(7, 21)))
                .andExpect(status().isOk());

        assertThat(request(ids[0], ".booking.start")).isEqualTo(at(7, 19).toString());
        assertThat(request(ids[0], ".booking.roomName")).isEqualTo("Møterom B");
        assertThat(request(ids[0], ".booking.status")).isEqualTo("APPROVED");
        assertThat(request(ids[0], ".start")).isEqualTo(at(7, 18).toString());
    }

    @Test
    void editingTimeAndRoomMovesTheBookingOnBehalfAndANewNameBecomesItsTitle() throws Exception {
        UUID[] ids = requestWithBooking();

        // Organisasjon C has no access to room A, but the admin's booking on its behalf can move there.
        call(put("/api/admin/public-requests/" + ids[0]), ADMIN,
                editJson("Vinterkonsert", ROOM_A, at(8, 18), at(8, 21), "Konsert i hagen", CONTACT))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DONE"))
                .andExpect(jsonPath("$.booking.roomId").value(ROOM_A.toString()))
                .andExpect(jsonPath("$.booking.roomName").value("Møterom A"))
                .andExpect(jsonPath("$.booking.title").value("Vinterkonsert"))
                .andExpect(jsonPath("$.booking.start").value(at(8, 18).toString()));

        assertThat(bookingStatus(ids[1])).isEqualTo("APPROVED");
        assertThat(jdbc.queryForObject("SELECT room_id FROM bookings WHERE id = ?", UUID.class, ids[1])).isEqualTo(ROOM_A);
        // The description is regenerated: the room asked for is now room A.
        assertThat(jdbc.queryForObject("SELECT description FROM bookings WHERE id = ?", String.class, ids[1]))
                .startsWith("Konsert i hagen\n\nKontakt: leder@example.test\nØnsket rom: Møterom A");
    }

    @Test
    void newTextRegeneratesTheDescriptionAndKeepsATitleChangedInTheCalendar() throws Exception {
        UUID[] ids = requestWithBooking();
        call(put("/api/bookings/" + ids[1]), ADMIN, """
                {"version":%d,"roomId":"%s","title":"Konsert (egen tittel)","description":"Egen tekst","start":"%s","end":"%s"}
                """.formatted(bookingVersion(ids[1]), ROOM_B, at(7, 18), at(7, 20)))
                .andExpect(status().isOk());
        String other = CONTACT.replace("Kari Nordmann", "Ola Nordmann");

        // Same name, time and room as the booking; only a contact changes.
        call(put("/api/admin/public-requests/" + ids[0]), ADMIN,
                editJson("Hagekonsert", ROOM_B, at(7, 18), at(7, 20), "Konsert i hagen", other))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.booking.title").value("Konsert (egen tittel)"));
        assertThat(jdbc.queryForObject("SELECT description FROM bookings WHERE id = ?", String.class, ids[1]))
                .startsWith("Konsert i hagen\n\n")
                .contains("- Ola Nordmann (Ekstern forening), kortnr. 12345678, tlf. +4791234567");
        assertThat(bookingStart(ids[1])).isEqualTo(at(7, 18));

        // Nothing the booking is made from changes: the
        // booking, including a description written in the calendar, is left alone.
        call(put("/api/bookings/" + ids[1]), ADMIN, """
                {"version":%d,"roomId":"%s","title":"Konsert (egen tittel)","description":"Egen tekst igjen","start":"%s","end":"%s"}
                """.formatted(bookingVersion(ids[1]), ROOM_B, at(7, 18), at(7, 20)))
                .andExpect(status().isOk());
        int version = bookingVersion(ids[1]);
        call(put("/api/admin/public-requests/" + ids[0]), ADMIN,
                editJson("Hagekonsert", ROOM_B, at(7, 18), at(7, 20), "Konsert i hagen", other))
                .andExpect(status().isOk());
        assertThat(bookingVersion(ids[1])).isEqualTo(version);
        assertThat(jdbc.queryForObject("SELECT description FROM bookings WHERE id = ?", String.class, ids[1])).isEqualTo("Egen tekst igjen");
    }

    @Test
    void anEditTheBookingRefusesSavesNothing() throws Exception {
        UUID[] ids = requestWithBooking();
        createBooking(KARI, ROOM_A, ORG_A, at(8, 18), at(8, 20));

        // Double booking.
        call(put("/api/admin/public-requests/" + ids[0]), ADMIN,
                editJson("Vinterkonsert", ROOM_A, at(8, 19), at(8, 21), "Ny tekst", CONTACT))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CONFLICT"));
        // Outside the room's opening hours (room A only opens Mondays 10–12).
        jdbc.update("INSERT INTO room_opening_hours (room_id, day_of_week, opens_minute, closes_minute) VALUES (?, 1, 600, 720)", ROOM_A);
        call(put("/api/admin/public-requests/" + ids[0]), ADMIN,
                editJson("Vinterkonsert", ROOM_A, at(9, 18), at(9, 20), "Ny tekst", CONTACT))
                .andExpect(status().isUnprocessableContent());
        // Over the booking's maximum length, though within the request's 22 hours.
        call(put("/api/admin/public-requests/" + ids[0]), ADMIN,
                editJson("Vinterkonsert", ROOM_B, oslo(10, 7, 0), oslo(10, 21, 0), "Ny tekst", CONTACT))
                .andExpect(status().isUnprocessableContent());
        // 05:00–07:00.
        call(put("/api/admin/public-requests/" + ids[0]), ADMIN,
                editJson("Vinterkonsert", ROOM_B, oslo(10, 22, 0), oslo(11, 6, 0), "Ny tekst", CONTACT))
                .andExpect(status().isUnprocessableContent());
        // A request with a booking needs a room.
        call(put("/api/admin/public-requests/" + ids[0]), ADMIN,
                editJson("Vinterkonsert", null, at(7, 18), at(7, 20), "Ny tekst", CONTACT))
                .andExpect(status().isBadRequest());

        assertThat(jdbc.queryForObject("SELECT event_name FROM public_requests WHERE id = ?", String.class, ids[0])).isEqualTo("Hagekonsert");
        assertThat(jdbc.queryForObject("SELECT description FROM public_requests WHERE id = ?", String.class, ids[0])).isEqualTo("Konsert i hagen");
        assertThat(jdbc.queryForObject("SELECT room_id FROM bookings WHERE id = ?", UUID.class, ids[1])).isEqualTo(ROOM_B);
        assertThat(bookingStart(ids[1])).isEqualTo(at(7, 18));
        assertThat(jdbc.queryForObject("SELECT title FROM bookings WHERE id = ?", String.class, ids[1])).isEqualTo("Hagekonsert");
    }

    @Test
    void aCancelledBookingReleasesTheRequestWhichCanBeBookedAgain() throws Exception {
        UUID[] ids = requestWithBooking();

        call(post("/api/bookings/" + ids[1] + "/cancel"), ADMIN, "{\"version\":%d}".formatted(bookingVersion(ids[1])))
                .andExpect(status().isOk());

        assertThat(request(ids[0], ".status")).isEqualTo("IN_PROGRESS");
        assertThat(request(ids[0], ".bookingId")).isEqualTo("null");
        assertThat(request(ids[0], ".booking")).isEqualTo("null");
        assertThat(request(ids[0], ".bookingRemovedAt")).isNotEqualTo("null");

        call(post("/api/admin/public-requests/" + ids[0] + "/booking"), ADMIN,
                bookingJson(ROOM_B, ORG_C, "Hagekonsert", at(7, 18), at(7, 20)))
                .andExpect(status().isCreated());
        assertThat(request(ids[0], ".status")).isEqualTo("DONE");
        assertThat(request(ids[0], ".bookingRemovedAt")).isEqualTo("null");
    }

    @Test
    void deletingTheRoomReleasesTheRequestButARejectedOneStaysRejected() throws Exception {
        UUID[] ids = requestWithBooking();
        // Rejected without cancelling the booking: the booking stays.
        call(put("/api/admin/public-requests/" + ids[0] + "/status"), ADMIN, "{\"status\":\"REJECTED\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookingId").value(ids[1].toString()));
        assertThat(bookingStatus(ids[1])).isEqualTo("APPROVED");

        jdbc.update("UPDATE rooms SET status = 'ARCHIVED' WHERE id = ?", ROOM_B);
        call(delete("/api/admin/rooms/" + ROOM_B), ADMIN, null).andExpect(status().is2xxSuccessful());

        assertThat(request(ids[0], ".status")).isEqualTo("REJECTED");
        assertThat(request(ids[0], ".bookingId")).isEqualTo("null");
        assertThat(request(ids[0], ".bookingRemovedAt")).isNotEqualTo("null");
    }

    @Test
    void rejectingCanCancelTheBookingToo() throws Exception {
        UUID[] ids = requestWithBooking();

        call(put("/api/admin/public-requests/" + ids[0] + "/status"), ADMIN, "{\"status\":\"DONE\",\"cancelBooking\":true}")
                .andExpect(status().isBadRequest());
        call(put("/api/admin/public-requests/" + ids[0] + "/status"), ADMIN, "{\"status\":\"REJECTED\",\"cancelBooking\":true}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.bookingId").doesNotExist())
                .andExpect(jsonPath("$.bookingRemovedAt").isString());
        assertThat(bookingStatus(ids[1])).isEqualTo("CANCELLED");
        assertThat(jdbc.queryForObject("SELECT cancellation_reason FROM bookings WHERE id = ?", String.class, ids[1]))
                .isEqualTo("Forespørselen er avslått.");
    }

    @Test
    void aBookingThatHasStartedCantBeCancelledByRejectingAndNothingChanges() throws Exception {
        UUID[] ids = requestWithBooking();
        jdbc.update("UPDATE bookings SET start_at = ?, end_at = ? WHERE id = ?",
                Timestamp.from(at(-1, 18)), Timestamp.from(at(-1, 20)), ids[1]);

        call(put("/api/admin/public-requests/" + ids[0] + "/status"), ADMIN, "{\"status\":\"REJECTED\",\"cancelBooking\":true}")
                .andExpect(status().isConflict());
        assertThat(request(ids[0], ".status")).isEqualTo("DONE");
        assertThat(bookingStatus(ids[1])).isEqualTo("APPROVED");
    }
}
