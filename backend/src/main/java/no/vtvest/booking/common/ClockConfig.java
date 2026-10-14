package no.vtvest.booking.common;

import java.time.Clock;
import java.time.ZoneId;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** The server clock is the only source of "now". Client time is never trusted. */
@Configuration
class ClockConfig {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    /**
     * The organization's local time zone. Times are stored as instants, but weekly series keep
     * their local wall-clock time across daylight saving changes in this zone.
     */
    @Bean
    ZoneId bookingTimeZone(@Value("${booking.time-zone}") String zone) {
        return ZoneId.of(zone);
    }
}
