package no.vtvest.booking.dev;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Development only: sample bookings for the current and the next week, so the calendar has
 * something to show. Runs on every start with the "dev" profile, after Flyway has loaded the
 * dev users, organizations and rooms (db/dev/R__dev_seed.sql).
 *
 * Each sample has a fixed id per week, and rows are inserted with ON CONFLICT DO NOTHING, so a
 * restart never duplicates them, and a sample the user has cancelled or decided stays as it is.
 * A sample that would overlap an existing approved booking is skipped by the same clause (the
 * exclusion constraint), so real bookings are never touched. Pending samples are only added
 * while their start time is still in the future.
 */
@Component
@Profile("dev")
class DevSampleBookings implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevSampleBookings.class);
    private static final ZoneId ZONE = ZoneId.of("Europe/Oslo");

    private static final UUID ORG_A = UUID.fromString("10000000-0000-0000-0000-00000000000a");
    private static final UUID ORG_B = UUID.fromString("10000000-0000-0000-0000-00000000000b");
    private static final UUID ORG_C = UUID.fromString("10000000-0000-0000-0000-00000000000c");
    private static final UUID KARI = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID OLA = UUID.fromString("20000000-0000-0000-0000-000000000002");
    private static final UUID INGRID = UUID.fromString("20000000-0000-0000-0000-000000000003");
    private static final UUID JONAS = UUID.fromString("20000000-0000-0000-0000-000000000004");
    private static final UUID ADMIN = UUID.fromString("20000000-0000-0000-0000-000000000005");
    private static final UUID ROOM_A = UUID.fromString("30000000-0000-0000-0000-00000000000a");
    private static final UUID ROOM_B = UUID.fromString("30000000-0000-0000-0000-00000000000b");
    private static final UUID STORSALEN = UUID.fromString("30000000-0000-0000-0000-00000000000c");

    /** DIRECT: booked without approval. GRANTED / REJECTED: decided requests. PENDING: awaiting an admin. */
    private enum Kind { DIRECT, GRANTED, REJECTED, PENDING }

    private record Sample(
            DayOfWeek day, String from, String to, UUID room, UUID org, UUID user, String title, String description, Kind kind) {}

    /** One week of activity, matching the frontend demo data and the dev room permissions. */
    private static final List<Sample> WEEK = List.of(
            new Sample(DayOfWeek.MONDAY, "16:00", "18:00", ROOM_A, ORG_A, KARI, "Styremøte", "Fast ukentlig styremøte.", Kind.DIRECT),
            new Sample(DayOfWeek.MONDAY, "18:00", "19:30", ROOM_B, ORG_C, INGRID, "Redaksjonsmøte", null, Kind.DIRECT),
            new Sample(DayOfWeek.TUESDAY, "12:15", "13:00", ROOM_A, ORG_B, OLA, "Økonomiutvalget", null, Kind.DIRECT),
            new Sample(DayOfWeek.TUESDAY, "17:00", "19:00", ROOM_B, ORG_A, KARI, "Workshop: søknadsskriving",
                    "Workshop for medlemmer om søknader til fond.", Kind.GRANTED),
            new Sample(DayOfWeek.WEDNESDAY, "10:00", "11:30", ROOM_A, ORG_A, JONAS, "Semesterplanlegging",
                    "Planlegging av arrangementer til våren.", Kind.DIRECT),
            new Sample(DayOfWeek.WEDNESDAY, "18:00", "22:00", STORSALEN, ORG_C, INGRID, "Quizkveld",
                    "Åpen quiz for alle studenter.", Kind.GRANTED),
            new Sample(DayOfWeek.THURSDAY, "14:00", "16:00", ROOM_A, ORG_B, OLA, "Intervjuer – nye frivillige", null, Kind.DIRECT),
            new Sample(DayOfWeek.THURSDAY, "18:00", "19:30", ROOM_B, ORG_C, JONAS, "Redaksjonsmøte", null, Kind.DIRECT),
            new Sample(DayOfWeek.FRIDAY, "18:00", "21:00", STORSALEN, ORG_B, OLA, "Allmøte",
                    "Semesterets allmøte med valg av nytt styre.", Kind.GRANTED),
            // Requests. "Debattmøte" overlaps the quiz night, so it can't be approved;
            // the two Saturday requests compete for the same slot.
            new Sample(DayOfWeek.WEDNESDAY, "19:00", "21:00", STORSALEN, ORG_A, KARI, "Debattmøte",
                    "Debatt om studentboliger med inviterte politikere.", Kind.PENDING),
            new Sample(DayOfWeek.THURSDAY, "13:00", "15:00", ROOM_B, ORG_A, JONAS, "Prosjektgruppe",
                    "Arbeidsmøte for prosjektgruppen.", Kind.PENDING),
            new Sample(DayOfWeek.SATURDAY, "17:00", "20:00", STORSALEN, ORG_B, OLA, "Filmkveld", null, Kind.PENDING),
            new Sample(DayOfWeek.SATURDAY, "18:00", "21:00", STORSALEN, ORG_C, INGRID, "Konsertøving",
                    "Generalprøve før vårkonserten.", Kind.PENDING),
            new Sample(DayOfWeek.THURSDAY, "19:00", "22:00", STORSALEN, ORG_C, INGRID, "Øvingskveld band", null, Kind.REJECTED));

    private final JdbcTemplate jdbc;
    private final Clock clock;

    DevSampleBookings(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Override
    public void run(ApplicationArguments args) {
        Instant now = clock.instant();
        LocalDate monday = LocalDate.ofInstant(now, ZONE).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        int inserted = 0;
        for (LocalDate week : List.of(monday, monday.plusWeeks(1))) {
            for (int i = 0; i < WEEK.size(); i++) {
                inserted += insert(week, i, WEEK.get(i), now);
            }
        }
        log.info("Dev sample bookings: {} added for the weeks of {} and {}", inserted, monday, monday.plusWeeks(1));
    }

    private int insert(LocalDate monday, int index, Sample s, Instant now) {
        LocalDate date = monday.with(TemporalAdjusters.nextOrSame(s.day()));
        Instant start = date.atTime(LocalTime.parse(s.from())).atZone(ZONE).toInstant();
        Instant end = date.atTime(LocalTime.parse(s.to())).atZone(ZONE).toInstant();
        if (s.kind() == Kind.PENDING && !start.isAfter(now)) {
            return 0;
        }
        Instant created = (start.isBefore(now) ? start : now).minus(Duration.ofDays(3));
        boolean decided = s.kind() == Kind.GRANTED || s.kind() == Kind.REJECTED;
        Instant decidedAt = decided ? created.plus(Duration.ofDays(1)) : null;
        String status = switch (s.kind()) {
            case DIRECT, GRANTED -> "APPROVED";
            case REJECTED -> "REJECTED";
            case PENDING -> "PENDING";
        };
        UUID id = UUID.nameUUIDFromBytes(("dev-sample:" + monday + ":" + index).getBytes(StandardCharsets.UTF_8));

        return jdbc.update(
                """
                INSERT INTO bookings (id, room_id, organization_id, requested_by_id, title, description,
                                      start_at, end_at, status, requires_approval, created_at,
                                      decided_at, decided_by_id, decision_comment)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT DO NOTHING
                """,
                id, s.room(), s.org(), s.user(), s.title(), s.description(),
                Timestamp.from(start), Timestamp.from(end), status, s.kind() != Kind.DIRECT, Timestamp.from(created),
                decidedAt == null ? null : Timestamp.from(decidedAt),
                decided ? ADMIN : null,
                s.kind() == Kind.REJECTED ? "Salen er satt av til rigging denne kvelden." : null);
    }
}
