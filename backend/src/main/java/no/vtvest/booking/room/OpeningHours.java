package no.vtvest.booking.room;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import no.vtvest.booking.common.ApiException;
import no.vtvest.booking.common.ErrorCode;

/**
 * A room's opening hours ({@code room_opening_hours}): at most one interval per weekday, in local
 * time ({@code booking.time-zone}). No intervals means open around the clock. Otherwise a booking
 * must lie within the interval of the day it starts on, so it can't cross midnight, except by
 * ending at exactly 24:00. The global 05:00–07:00 closing (ClosedHours) applies on top. Mirrored in
 * bookingRules.ts.
 */
public final class OpeningHours {

    static final int DAY_MINUTES = 24 * 60;
    private static final Pattern TIME = Pattern.compile("^([01][0-9]|2[0-4]):([0-5][0-9])$");
    private static final String[] DAY_NAMES = {"man", "tir", "ons", "tor", "fre", "lør", "søn"};

    /** One weekday's hours, in minutes after local midnight; {@code closes} 1440 is 24:00. */
    public record Interval(DayOfWeek day, int opens, int closes) {}

    /** As sent and returned by the API: {@code "16:30"}, and {@code "24:00"} for closing at midnight. */
    public record Entry(DayOfWeek day, String opens, String closes) {}

    private OpeningHours() {}

    /** Validates the API's entries: one per weekday at most, opening before closing. */
    public static List<Interval> parse(List<Entry> entries) {
        if (entries == null) {
            return List.of();
        }
        List<Interval> intervals = new ArrayList<>();
        for (Entry e : entries) {
            if (e == null || e.day() == null) {
                throw new ApiException(ErrorCode.VALIDATION, "Velg en ukedag for åpningstiden.");
            }
            int opens = minutes(e.opens());
            int closes = minutes(e.closes());
            if (opens >= DAY_MINUTES || closes <= opens) {
                throw new ApiException(ErrorCode.VALIDATION, "Åpningstiden må starte før den slutter, og slutte senest 24:00.");
            }
            if (intervals.stream().anyMatch(i -> i.day() == e.day())) {
                throw new ApiException(ErrorCode.VALIDATION, "Hver ukedag kan bare ha én åpningstid.");
            }
            intervals.add(new Interval(e.day(), opens, closes));
        }
        intervals.sort(Comparator.comparing(Interval::day));
        return List.copyOf(intervals);
    }

    private static int minutes(String time) {
        Matcher m = time == null ? null : TIME.matcher(time.strip());
        if (m == null || !m.matches()) {
            throw new ApiException(ErrorCode.VALIDATION, "Åpningstider skrives som TT:MM, for eksempel 16:30.");
        }
        int value = Integer.parseInt(m.group(1)) * 60 + Integer.parseInt(m.group(2));
        if (value > DAY_MINUTES) {
            throw new ApiException(ErrorCode.VALIDATION, "Åpningstider skrives som TT:MM, for eksempel 16:30.");
        }
        return value;
    }

    public static List<Entry> toEntries(List<Interval> intervals) {
        return intervals.stream().map(i -> new Entry(i.day(), format(i.opens()), format(i.closes()))).toList();
    }

    static String format(int minutes) {
        return "%02d:%02d".formatted(minutes / 60, minutes % 60);
    }

    /** Whether [start, end) lies within the room's hours. Always true without hours. */
    public static boolean allows(List<Interval> intervals, Instant start, Instant end, ZoneId zone) {
        if (intervals.isEmpty()) {
            return true;
        }
        ZonedDateTime from = start.atZone(zone);
        LocalDate day = from.toLocalDate();
        Interval open = intervals.stream().filter(i -> i.day() == day.getDayOfWeek()).findFirst().orElse(null);
        if (open == null) {
            return false;
        }
        ZonedDateTime to = end.atZone(zone);
        int startMinute = from.getHour() * 60 + from.getMinute();
        int endMinute;
        if (to.toLocalDate().equals(day)) {
            endMinute = to.getHour() * 60 + to.getMinute();
        } else if (to.toLocalDate().equals(day.plusDays(1)) && to.toLocalTime().toSecondOfDay() == 0) {
            endMinute = DAY_MINUTES;
        } else {
            return false;
        }
        return open.opens() <= startMinute && endMinute <= open.closes();
    }

    public static void require(String roomName, List<Interval> intervals, Instant start, Instant end, ZoneId zone) {
        if (!allows(intervals, start, end, zone)) {
            throw new ApiException(ErrorCode.RULE_VIOLATION, roomName + " er bare åpent " + describe(intervals) + ".");
        }
    }

    /** E.g. "man–fre 16:30–24:00, lør–søn 08:00–16:00": consecutive days with the same hours grouped. */
    public static String describe(List<Interval> intervals) {
        List<String> parts = new ArrayList<>();
        int i = 0;
        while (i < intervals.size()) {
            Interval first = intervals.get(i);
            int j = i;
            while (j + 1 < intervals.size()
                    && intervals.get(j + 1).day().getValue() == intervals.get(j).day().getValue() + 1
                    && intervals.get(j + 1).opens() == first.opens()
                    && intervals.get(j + 1).closes() == first.closes()) {
                j++;
            }
            String days = DAY_NAMES[first.day().getValue() - 1]
                    + (j > i ? "–" + DAY_NAMES[intervals.get(j).day().getValue() - 1] : "");
            parts.add(days + " " + format(first.opens()) + "–" + format(first.closes()));
            i = j + 1;
        }
        return String.join(", ", parts);
    }
}
