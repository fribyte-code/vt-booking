package no.vtvest.booking.room;

import java.time.DayOfWeek;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Reads and writes {@code room_opening_hours} with JdbcTemplate, like the other room data. */
@Repository
public class OpeningHoursRepository {

    private static final String SELECT = "SELECT room_id, day_of_week, opens_minute, closes_minute FROM room_opening_hours";

    private final JdbcTemplate jdbc;

    OpeningHoursRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<OpeningHours.Interval> forRoom(UUID roomId) {
        return jdbc.query(SELECT + " WHERE room_id = ? ORDER BY day_of_week", (rs, i) -> interval(rs), roomId);
    }

    /** Every room's hours, by room id; rooms without hours are left out. */
    public Map<UUID, List<OpeningHours.Interval>> all() {
        return jdbc.query(SELECT + " ORDER BY day_of_week",
                        (rs, i) -> Map.entry(rs.getObject("room_id", UUID.class), interval(rs)))
                .stream()
                .collect(Collectors.groupingBy(Map.Entry::getKey, Collectors.mapping(Map.Entry::getValue, Collectors.toList())));
    }

    /** Replaces the room's hours. The caller holds the room row's lock (it updates the row). */
    public void replace(UUID roomId, List<OpeningHours.Interval> intervals) {
        jdbc.update("DELETE FROM room_opening_hours WHERE room_id = ?", roomId);
        for (OpeningHours.Interval i : intervals) {
            jdbc.update("INSERT INTO room_opening_hours (room_id, day_of_week, opens_minute, closes_minute) VALUES (?, ?, ?, ?)",
                    roomId, i.day().getValue(), i.opens(), i.closes());
        }
    }

    private static OpeningHours.Interval interval(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new OpeningHours.Interval(
                DayOfWeek.of(rs.getInt("day_of_week")), rs.getInt("opens_minute"), rs.getInt("closes_minute"));
    }
}
