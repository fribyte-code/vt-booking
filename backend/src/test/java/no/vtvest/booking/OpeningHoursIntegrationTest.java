package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Opening hours per room (set by system admins) and the public form flag. */
class OpeningHoursIntegrationTest extends IntegrationTest {

    private static final ZoneId OSLO = ZoneId.of("Europe/Oslo");
    /** UiB-kantina's hours: weekdays 16:30–24:00, weekends 08:00–16:00. */
    private static final String CANTEEN_HOURS = """
            [{"day":"MONDAY","opens":"16:30","closes":"24:00"},{"day":"TUESDAY","opens":"16:30","closes":"24:00"},
             {"day":"WEDNESDAY","opens":"16:30","closes":"24:00"},{"day":"THURSDAY","opens":"16:30","closes":"24:00"},
             {"day":"FRIDAY","opens":"16:30","closes":"24:00"},{"day":"SATURDAY","opens":"08:00","closes":"16:00"},
             {"day":"SUNDAY","opens":"08:00","closes":"16:00"}]
            """;

    private static String roomJson(String hours, Boolean requestable) {
        return """
                {"name":"Møterom A","description":null,"location":null,"capacity":8,"color":"#2563eb",
                 "defaultPermission":"REQUEST","publicRequestable":%s,"openingHours":%s}
                """.formatted(requestable, hours);
    }

    /** Local time on the given weekday, at least a week ahead. */
    private static Instant on(DayOfWeek day, int hour, int minute) {
        return LocalDate.now(OSLO).plusDays(7).with(TemporalAdjusters.next(day)).atTime(hour, minute).atZone(OSLO).toInstant();
    }

    @Test
    void adminSetsHoursAndTheFormFlag() throws Exception {
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, roomJson(CANTEEN_HOURS, true))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publicRequestable").value(true))
                .andExpect(jsonPath("$.openingHours.length()").value(7))
                .andExpect(jsonPath("$.openingHours[0].day").value("MONDAY"))
                .andExpect(jsonPath("$.openingHours[0].closes").value("24:00"));
        // Left out: both unchanged.
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, roomJson("null", null))
                .andExpect(jsonPath("$.publicRequestable").value(true))
                .andExpect(jsonPath("$.openingHours.length()").value(7));
        // Users see the hours with the rooms.
        call(get("/api/rooms"), KARI, null)
                .andExpect(jsonPath("$[?(@.id == '" + ROOM_A + "')].openingHours.length()").value(7));
        // Empty: open around the clock again.
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, roomJson("[]", false))
                .andExpect(jsonPath("$.publicRequestable").value(false))
                .andExpect(jsonPath("$.openingHours.length()").value(0));
    }

    @Test
    void invalidHoursAreRefused() throws Exception {
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, roomJson("[{\"day\":\"MONDAY\",\"opens\":\"18:00\",\"closes\":\"16:00\"}]", null))
                .andExpect(status().isBadRequest());
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, roomJson("[{\"day\":\"MONDAY\",\"opens\":\"8\",\"closes\":\"16:00\"}]", null))
                .andExpect(status().isBadRequest());
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, roomJson("[{\"day\":\"MONDAY\",\"opens\":\"08:00\",\"closes\":\"24:30\"}]", null))
                .andExpect(status().isBadRequest());
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, roomJson(
                        "[{\"day\":\"MONDAY\",\"opens\":\"08:00\",\"closes\":\"10:00\"},{\"day\":\"MONDAY\",\"opens\":\"12:00\",\"closes\":\"14:00\"}]", null))
                .andExpect(status().isBadRequest());
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, roomJson(CANTEEN_HOURS, null)).andExpect(status().isOk());
        call(put("/api/admin/rooms/" + ROOM_A), KARI, roomJson("[]", null)).andExpect(status().isForbidden());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM room_opening_hours", Integer.class)).isEqualTo(7);
    }

    @Test
    void bookingsMustBeWithinTheHoursForEveryone() throws Exception {
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, roomJson(CANTEEN_HOURS, null)).andExpect(status().isOk());

        call(post("/api/bookings"), KARI, bookingJson(ROOM_A, ORG_A, "Lunsj", on(DayOfWeek.TUESDAY, 12, 0), on(DayOfWeek.TUESDAY, 13, 0)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("RULE_VIOLATION"))
                .andExpect(jsonPath("$.detail").value("Møterom A er bare åpent man–fre 16:30–24:00, lør–søn 08:00–16:00."));
        // Past midnight is outside a weekday's hours, which end at 24:00.
        call(post("/api/bookings"), KARI, bookingJson(ROOM_A, ORG_A, "Fest", on(DayOfWeek.FRIDAY, 20, 0), on(DayOfWeek.SATURDAY, 1, 0)))
                .andExpect(status().isUnprocessableContent());
        createBooking(KARI, ROOM_A, ORG_A, on(DayOfWeek.FRIDAY, 18, 0), on(DayOfWeek.SATURDAY, 0, 0));
        createBooking(KARI, ROOM_A, ORG_A, on(DayOfWeek.SUNDAY, 8, 0), on(DayOfWeek.SUNDAY, 16, 0));

        // A system admin booking on behalf of a public request is held to them too.
        String request = """
                {"email":"a@example.test","organizationName":"Ekstern","eventName":"Fest","memberOfKulturstyretOrSamfunnet":false,
                 "preferredRoomId":null,"start":"%s","end":"%s","description":"Fest",
                 "contacts":[{"name":"Kari","organization":"Ekstern","cardNumber":"123456","phone":"91234567"}]}
                """.formatted(on(DayOfWeek.WEDNESDAY, 12, 0), on(DayOfWeek.WEDNESDAY, 14, 0));
        mvc.perform(post("/api/public/requests").with(withCsrf())
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(request))
                .andExpect(status().isNoContent());
        UUID requestId = jdbc.queryForObject("SELECT id FROM public_requests", UUID.class);
        call(post("/api/admin/public-requests/" + requestId + "/booking"), ADMIN,
                        bookingJson(ROOM_A, ORG_B, "Fest", on(DayOfWeek.WEDNESDAY, 12, 0), on(DayOfWeek.WEDNESDAY, 14, 0)))
                .andExpect(status().isUnprocessableContent());
    }

    @Test
    void movesSeriesAndApprovalsAreCheckedAgainstTheHours() throws Exception {
        UUID booking = createBooking(KARI, ROOM_A, ORG_A, on(DayOfWeek.TUESDAY, 18, 0), on(DayOfWeek.TUESDAY, 19, 0));
        // A pending request made before the hours were set.
        String pending = com.jayway.jsonpath.JsonPath.read(call(post("/api/bookings"), KARI,
                        bookingJson(ROOM_B, ORG_A, "Søknad", on(DayOfWeek.TUESDAY, 10, 0), on(DayOfWeek.TUESDAY, 11, 0)))
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andReturn().getResponse().getContentAsString(), "$.id");
        call(put("/api/admin/rooms/" + ROOM_A), ADMIN, roomJson(CANTEEN_HOURS, null)).andExpect(status().isOk());
        call(put("/api/admin/rooms/" + ROOM_B), ADMIN, roomJson(CANTEEN_HOURS, null).replace("Møterom A", "Møterom B"))
                .andExpect(status().isOk());

        // Existing bookings are kept, but can't be moved outside the hours.
        call(put("/api/bookings/" + booking), KARI, """
                {"version":%d,"roomId":"%s","title":"Flyttet","start":"%s","end":"%s"}
                """.formatted(bookingVersion(booking), ROOM_A, on(DayOfWeek.TUESDAY, 15, 0), on(DayOfWeek.TUESDAY, 17, 0)))
                .andExpect(status().isUnprocessableContent());

        call(post("/api/bookings/series/preview"), KARI, """
                {"roomId":"%s","organizationId":"%s","title":"Ukentlig","start":"%s","end":"%s",
                 "recurrence":{"intervalWeeks":1,"until":"%s"},"skipConflicts":false}
                """.formatted(ROOM_A, ORG_A, on(DayOfWeek.MONDAY, 15, 0), on(DayOfWeek.MONDAY, 17, 0),
                        on(DayOfWeek.MONDAY, 15, 0).atZone(OSLO).toLocalDate().plusWeeks(2)))
                .andExpect(status().isUnprocessableContent());

        call(post("/api/bookings/" + pending + "/approve"), ADMIN, "{\"version\":0}")
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("RULE_VIOLATION"));
    }
}
