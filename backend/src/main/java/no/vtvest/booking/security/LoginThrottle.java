package no.vtvest.booking.security;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Slows down password guessing: after too many failed logins for one email address, or from
 * one IP address, within 15 minutes, further attempts are refused with 429 until the window
 * passes. In memory, which is enough for a single API instance. It throttles instead of locking
 * accounts, so an attacker can only delay a real user by 15 minutes, not lock them out for good.
 */
@Component
public class LoginThrottle {

    static final Duration WINDOW = Duration.ofMinutes(15);
    static final int MAX_FAILURES_PER_EMAIL = 5;
    static final int MAX_FAILURES_PER_IP = 30;

    private record Window(Instant start, int failures) {}

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final Clock clock;

    LoginThrottle(Clock clock) {
        this.clock = clock;
    }

    public boolean isBlocked(String ip, String email) {
        return failures("ip:" + ip) >= MAX_FAILURES_PER_IP || failures(emailKey(email)) >= MAX_FAILURES_PER_EMAIL;
    }

    public void recordFailure(String ip, String email) {
        Instant now = clock.instant();
        if (windows.size() > 10_000) {
            windows.values().removeIf(w -> w.start().plus(WINDOW).isBefore(now));
        }
        for (String key : new String[] {"ip:" + ip, emailKey(email)}) {
            windows.merge(key, new Window(now, 1), (old, fresh) ->
                    old.start().plus(WINDOW).isBefore(now) ? fresh : new Window(old.start(), old.failures() + 1));
        }
    }

    public void recordSuccess(String email) {
        windows.remove(emailKey(email));
    }

    /** Forgets all failures. Used by tests. */
    public void clear() {
        windows.clear();
    }

    private int failures(String key) {
        Window window = windows.get(key);
        if (window == null) return 0;
        if (window.start().plus(WINDOW).isBefore(clock.instant())) {
            windows.remove(key, window);
            return 0;
        }
        return window.failures();
    }

    private static String emailKey(String email) {
        return "email:" + (email == null ? "" : email.trim().toLowerCase(Locale.ROOT));
    }
}
