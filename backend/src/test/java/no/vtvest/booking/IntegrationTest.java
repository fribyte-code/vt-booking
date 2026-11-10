package no.vtvest.booking;

import jakarta.servlet.http.Cookie;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import no.vtvest.booking.security.LoginThrottle;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.jdbc.Sql;
import com.jayway.jsonpath.JsonPath;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * Full application against PostgreSQL. Before every test, test-fixtures.sql replaces all data
 * with a fixed set of users, organizations, rooms and permissions, so tests are isolated and
 * never depend on seed data (the application has none).
 *
 * The user constants are principal names, which are user IDs: use them with
 * spring-security-test's {@code user(KARI)}, exactly like a real session after password login.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration.class)
@Sql("/test-fixtures.sql")
abstract class IntegrationTest {

    /** Every fixture user's password. */
    static final String PASSWORD = "fixture-passord-2026";

    static final String KARI = "20000000-0000-0000-0000-000000000001"; // Organisasjon A
    static final String OLA = "20000000-0000-0000-0000-000000000002"; // Organisasjon B
    static final String JONAS = "20000000-0000-0000-0000-000000000004"; // ORG_ADMIN of Organisasjon A, member of C
    static final String ADMIN = "20000000-0000-0000-0000-000000000005"; // SYSTEM_ADMIN, no memberships

    static final String KARI_EMAIL = "kari@example.test";
    static final String ADMIN_EMAIL = "admin@example.test";

    static final UUID KARI_ID = UUID.fromString(KARI);
    static final UUID OLA_ID = UUID.fromString(OLA);
    static final UUID JONAS_ID = UUID.fromString(JONAS);
    static final UUID ADMIN_ID = UUID.fromString(ADMIN);

    static final UUID ORG_A = UUID.fromString("10000000-0000-0000-0000-00000000000a");
    static final UUID ORG_B = UUID.fromString("10000000-0000-0000-0000-00000000000b");

    /** Org A and B: DIRECT. Org C: NONE. */
    static final UUID ROOM_A = UUID.fromString("30000000-0000-0000-0000-00000000000a");
    /** Org A: REQUEST. Org B: NONE. */
    static final UUID ROOM_B = UUID.fromString("30000000-0000-0000-0000-00000000000b");
    /** Everyone: REQUEST. */
    static final UUID STORSALEN = UUID.fromString("30000000-0000-0000-0000-00000000000c");

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    LoginThrottle loginThrottle;

    /** All tests log in from the same address, so failed logins must not add up across tests. */
    @BeforeEach
    void resetLoginThrottle() {
        loginThrottle.clear();
    }

    /** A whole hour {@code days} days from now, at {@code hour} UTC. */
    static Instant at(int days, int hour) {
        return Instant.now().truncatedTo(ChronoUnit.DAYS).plus(days, ChronoUnit.DAYS).plus(hour, ChronoUnit.HOURS);
    }

    /** Wall-clock time in Oslo (booking.time-zone), {@code days} from today. */
    static Instant oslo(int days, int hour, int minute) {
        java.time.ZoneId zone = java.time.ZoneId.of("Europe/Oslo");
        return java.time.LocalDate.now(zone).plusDays(days).atTime(hour, minute).atZone(zone).toInstant();
    }

    /**
     * Sends a matching XSRF-TOKEN cookie and X-XSRF-TOKEN header, exactly like the SPA will.
     * We avoid spring-security-test's csrf() helper: it swaps the CSRF repository in the
     * shared application context for one that never writes cookies, which breaks other tests.
     */
    static RequestPostProcessor withCsrf() {
        String token = UUID.randomUUID().toString();
        return request -> {
            request.setCookies(new Cookie("XSRF-TOKEN", token));
            request.addHeader("X-XSRF-TOKEN", token);
            return request;
        };
    }

    static String bookingJson(UUID roomId, UUID orgId, String title, Instant start, Instant end) {
        return """
                {"roomId":"%s","organizationId":"%s","title":"%s","start":"%s","end":"%s"}
                """.formatted(roomId, orgId, title, start, end);
    }

    /** Sends a request as {@code actor} (a user ID), with CSRF and an optional JSON body. */
    ResultActions call(MockHttpServletRequestBuilder request, String actor, String json) throws Exception {
        request.with(withCsrf()).with(user(actor));
        if (json != null) request.contentType(MediaType.APPLICATION_JSON).content(json);
        return mvc.perform(request);
    }

    /** Books through the API and returns the new booking's id. */
    UUID createBooking(String actor, UUID roomId, UUID orgId, Instant start, Instant end) throws Exception {
        String body = call(post("/api/bookings"), actor, bookingJson(roomId, orgId, "Test", start, end))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(JsonPath.read(body, "$.id"));
    }

    int bookingVersion(UUID id) {
        return jdbc.queryForObject("SELECT version FROM bookings WHERE id = ?", Integer.class, id);
    }

    String bookingStatus(UUID id) {
        return jdbc.queryForObject("SELECT status FROM bookings WHERE id = ?", String.class, id);
    }

    /** Inserts a one-hour booking directly, bypassing the rules (e.g. one that has already started). */
    UUID insertBooking(UUID roomId, UUID orgId, UUID requesterId, Instant start, String status) {
        return jdbc.queryForObject("""
                INSERT INTO bookings (room_id, organization_id, requested_by_id, title, start_at, end_at, status, requires_approval)
                VALUES (?, ?, ?, 'Direkte', ?::timestamptz, ?::timestamptz, ?, ?)
                RETURNING id
                """, UUID.class, roomId, orgId, requesterId, start.toString(),
                start.plus(1, ChronoUnit.HOURS).toString(), status, status.equals("PENDING"));
    }
}
