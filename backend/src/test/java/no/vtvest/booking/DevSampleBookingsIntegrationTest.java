package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.ApplicationContext;

/** The dev-profile sample bookings: realistic data that never duplicates or overwrites anything. */
class DevSampleBookingsIntegrationTest extends IntegrationTest {

    @Autowired
    ApplicationContext context;

    private void seed() throws Exception {
        context.getBean("devSampleBookings", ApplicationRunner.class).run(null);
    }

    private int count(String where) {
        return jdbc.queryForObject("SELECT count(*) FROM bookings WHERE " + where, Integer.class);
    }

    @Test
    void addsBookingsForThisWeekOnceOnly() throws Exception {
        seed();
        int total = count("true");
        Instant weekStart = ZonedDateTime.now(ZoneId.of("Europe/Oslo"))
                .truncatedTo(ChronoUnit.DAYS)
                .with(java.time.DayOfWeek.MONDAY)
                .toInstant();

        assertThat(count("status = 'APPROVED' AND start_at >= '%s' AND start_at < '%s'"
                .formatted(weekStart, weekStart.plus(7, ChronoUnit.DAYS)))).isGreaterThanOrEqualTo(9);
        assertThat(count("status = 'REJECTED'")).isEqualTo(2);
        assertThat(count("status = 'PENDING' AND start_at <= now()")).isZero();

        seed();
        assertThat(count("true")).isEqualTo(total);
    }

    @Test
    void keepsExistingBookingsAndDecisions() throws Exception {
        // A real booking in the slot of Monday's "Styremøte" sample, made by someone else.
        ZonedDateTime monday = ZonedDateTime.now(ZoneId.of("Europe/Oslo"))
                .truncatedTo(ChronoUnit.DAYS)
                .with(java.time.DayOfWeek.MONDAY)
                .plusWeeks(1);
        jdbc.update(
                """
                INSERT INTO bookings (room_id, organization_id, requested_by_id, title, start_at, end_at, status, requires_approval)
                VALUES (?, ?, ?, 'Ekte booking', ?, ?, 'APPROVED', false)
                """,
                ROOM_A, ORG_B, OLA_ID,
                Timestamp.from(monday.withHour(16).toInstant()), Timestamp.from(monday.withHour(17).toInstant()));

        seed();
        assertThat(count("title = 'Ekte booking' AND status = 'APPROVED'")).isEqualTo(1);
        assertThat(count("title = 'Styremøte' AND start_at = '%s'".formatted(monday.withHour(16).toInstant()))).isZero();

        // A sample the user has cancelled stays cancelled after a restart.
        jdbc.update("""
                UPDATE bookings SET status = 'CANCELLED', cancelled_at = now(), cancelled_by_id = ?
                WHERE title = 'Allmøte'
                """, OLA_ID);
        seed();
        assertThat(count("title = 'Allmøte' AND status = 'APPROVED'")).isZero();
    }
}
