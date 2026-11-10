package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;

/** Natt: coming events past midnight in every room, and "Vektere bestilt" (V12). */
class NightIntegrationTest extends IntegrationTest {

    private static final UUID ORG_C = UUID.fromString("10000000-0000-0000-0000-00000000000c");

    @BeforeEach
    void offerStorsalen() {
        jdbc.update("UPDATE rooms SET public_requestable = true WHERE id = ?", STORSALEN);
    }

    private UUID submit(String eventName, Instant start, Instant end) throws Exception {
        mvc.perform(post("/api/public/requests").with(withCsrf()).contentType(MediaType.APPLICATION_JSON).content("""
                        {"email":"leder@example.test","organizationName":"Ekstern forening","eventName":"%s","memberOfKulturstyretOrSamfunnet":true,
                         "preferredRoomId":"%s","start":"%s","end":"%s","description":"Fest",
                         "contacts":[{"name":"Kari Nordmann","organization":"Ekstern forening","cardNumber":"123456","phone":"+4791234567"}]}
                        """.formatted(eventName, STORSALEN, start, end)))
                .andExpect(status().isNoContent());
        return jdbc.queryForObject("SELECT id FROM public_requests WHERE event_name = ?", UUID.class, eventName);
    }

    private String night() throws Exception {
        return call(get("/api/admin/night"), ADMIN, null).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    }

    private long count() throws Exception {
        String body = call(get("/api/admin/night/count"), ADMIN, null).andReturn().getResponse().getContentAsString();
        return ((Number) JsonPath.read(body, "$.count")).longValue();
    }

    private void guards(String json) throws Exception {
        call(put("/api/admin/night/guards"), ADMIN, json).andExpect(status().isNoContent());
    }

    @Test
    void listsComingEventsPastMidnightInEveryRoomOnce() throws Exception {
        UUID overnight = createBooking(KARI, ROOM_A, ORG_A, oslo(7, 22, 0), oslo(8, 2, 0));
        createBooking(KARI, ROOM_A, ORG_A, oslo(7, 12, 0), oslo(7, 14, 0)); // daytime
        createBooking(KARI, ROOM_A, ORG_A, oslo(9, 20, 0), oslo(10, 0, 0)); // ends at 24:00: not past midnight
        UUID pending = createBooking(KARI, STORSALEN, ORG_A, oslo(9, 22, 0), oslo(10, 1, 0)); // REQUEST access
        UUID open = submit("Åpen fest", oslo(11, 21, 0), oslo(12, 3, 0));
        UUID rejected = submit("Avslått fest", oslo(12, 21, 0), oslo(13, 3, 0));
        call(post("/api/admin/public-requests/" + rejected + "/reject"), ADMIN, null).andExpect(status().isOk());
        UUID booked = submit("Booket fest", oslo(13, 21, 0), oslo(14, 3, 0));
        String created = call(post("/api/admin/public-requests/" + booked + "/booking"), ADMIN,
                        bookingJson(ROOM_B, ORG_C, "Booket fest", oslo(13, 21, 0), oslo(14, 3, 0)))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String bookedId = JsonPath.read(created, "$.id");

        String body = night();
        List<String> kinds = JsonPath.read(body, "$[*].kind");
        List<String> titles = JsonPath.read(body, "$[*].title");
        assertThat(titles).containsExactly("Test", "Test", "Åpen fest", "Booket fest");
        assertThat(kinds).containsExactly("BOOKING", "REQUEST", "PUBLIC_REQUEST", "BOOKING");
        assertThat(JsonPath.<List<String>>read(body, "$[*].bookingId"))
                .containsExactly(overnight.toString(), pending.toString(), null, bookedId);
        // The booked request is shown once, as the booking, with the request's contacts.
        assertThat(JsonPath.<String>read(body, "$[3].publicRequestId")).isEqualTo(booked.toString());
        assertThat(JsonPath.<String>read(body, "$[3].contacts[0].phone")).isEqualTo("+4791234567");
        assertThat(JsonPath.<String>read(body, "$[2].publicRequestId")).isEqualTo(open.toString());
        assertThat(JsonPath.<String>read(body, "$[2].roomName")).isEqualTo("Storsalen");
        assertThat(count()).isEqualTo(4);

        call(get("/api/admin/night"), KARI, null).andExpect(status().isForbidden());
        call(get("/api/admin/night/count"), KARI, null).andExpect(status().isForbidden());
    }

    @Test
    void guardsAreTickedOffWithWhoAndWhenAndFollowARequestIntoItsBooking() throws Exception {
        UUID booking = createBooking(KARI, ROOM_A, ORG_A, oslo(7, 22, 0), oslo(8, 2, 0));
        UUID request = submit("Fest", oslo(9, 21, 0), oslo(10, 3, 0));
        assertThat(count()).isEqualTo(2);

        guards("{\"bookingId\":\"" + booking + "\",\"ordered\":true}");
        guards("{\"publicRequestId\":\"" + request + "\",\"ordered\":true}");
        assertThat(count()).isZero();
        String body = night();
        assertThat(JsonPath.<String>read(body, "$[0].guardsOrderedByName")).isEqualTo("Silje Aas");
        assertThat(JsonPath.<String>read(body, "$[0].guardsOrderedAt")).isNotNull();

        // Ticking off again keeps it; unticking removes it.
        guards("{\"bookingId\":\"" + booking + "\",\"ordered\":true}");
        guards("{\"bookingId\":\"" + booking + "\",\"ordered\":false}");
        assertThat(count()).isEqualTo(1);

        // The request becomes a booking: the mark is the request's and stays with the event.
        call(post("/api/admin/public-requests/" + request + "/booking"), ADMIN,
                bookingJson(ROOM_B, ORG_C, "Fest", oslo(9, 21, 0), oslo(10, 3, 0)))
                .andExpect(status().isCreated());
        body = night();
        assertThat(JsonPath.<String>read(body, "$[1].kind")).isEqualTo("BOOKING");
        assertThat(JsonPath.<String>read(body, "$[1].guardsOrderedByName")).isEqualTo("Silje Aas");
        // Marked through its booking id, it still lands on the request.
        String bookingOfRequest = JsonPath.read(body, "$[1].bookingId");
        guards("{\"bookingId\":\"" + bookingOfRequest + "\",\"ordered\":false}");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM guard_orders", Integer.class)).isZero();

        call(put("/api/admin/night/guards"), ADMIN, "{\"ordered\":true}").andExpect(status().isBadRequest());
        call(put("/api/admin/night/guards"), ADMIN, "{\"bookingId\":\"" + UUID.randomUUID() + "\",\"ordered\":true}")
                .andExpect(status().isNotFound());
        call(put("/api/admin/night/guards"), KARI, "{\"bookingId\":\"" + booking + "\",\"ordered\":true}")
                .andExpect(status().isForbidden());
    }
}
