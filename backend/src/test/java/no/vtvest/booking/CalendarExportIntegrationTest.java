package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** "Legg til i kalender": approved bookings and series as iCalendar files. */
class CalendarExportIntegrationTest extends IntegrationTest {

    private String ics(String actor, String path) throws Exception {
        return call(get(path), actor, null)
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "text/calendar;charset=UTF-8"))
                .andExpect(header().string("Content-Disposition", "inline; filename=\"booking.ics\""))
                .andReturn().getResponse().getContentAsString();
    }

    @Test
    void approvedBookingIsOneEventVisibleToEveryone() throws Exception {
        Instant start = at(7, 10);
        UUID id = createBooking(KARI, ROOM_A, ORG_A, start, at(7, 12));

        String own = ics(KARI, "/api/bookings/" + id + "/calendar.ics");
        assertThat(own)
                .startsWith("BEGIN:VCALENDAR\r\n")
                .endsWith("END:VCALENDAR\r\n")
                .contains("UID:" + id + "@rombooking.vtvest.no\r\n")
                .contains("DTSTART:" + start.toString().replace("-", "").replace(":", "") + "\r\n")
                .contains("SUMMARY:Test\r\n")
                .contains("DESCRIPTION:Booket for Organisasjon A\r\n");
        assertThat(own.split("BEGIN:VEVENT", -1)).hasSize(2);

        // Approved bookings are visible to every user, as in the calendar.
        ics(OLA, "/api/bookings/" + id + "/calendar.ics");
    }

    @Test
    void pendingRequestCannotBeAddedAndHiddenOnesAreNotFound() throws Exception {
        UUID request = createBooking(KARI, STORSALEN, ORG_A, at(7, 10), at(7, 12));

        call(get("/api/bookings/" + request + "/calendar.ics"), KARI, null).andExpect(status().isConflict());
        call(get("/api/bookings/" + request + "/calendar.ics"), OLA, null).andExpect(status().isNotFound());
    }

    @Test
    void seriesHasOneEventPerUpcomingApprovedOccurrence() throws Exception {
        Instant start = at(7, 10);
        String until = start.atZone(ZoneId.of("Europe/Oslo")).toLocalDate().plusWeeks(2).toString();
        String body = call(post("/api/bookings/series"), KARI, """
                {"roomId":"%s","organizationId":"%s","title":"Øving","start":"%s","end":"%s",
                 "recurrence":{"intervalWeeks":1,"until":"%s"},"skipConflicts":false}
                """.formatted(ROOM_A, ORG_A, start, at(7, 12), until))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID seriesId = UUID.fromString(JsonPath.read(body, "$.seriesId"));
        UUID cancelled = jdbc.queryForObject(
                "SELECT id FROM bookings WHERE series_id = ? ORDER BY start_at OFFSET 1 LIMIT 1", UUID.class, seriesId);
        call(post("/api/bookings/" + cancelled + "/cancel"), KARI, "{\"version\":0}").andExpect(status().isOk());

        String ics = ics(KARI, "/api/bookings/series/" + seriesId + "/calendar.ics");
        assertThat(ics.split("BEGIN:VEVENT", -1)).hasSize(3);
        assertThat(ics).doesNotContain(cancelled.toString()).contains("SUMMARY:Øving\r\n");
    }
}
