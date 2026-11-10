package no.vtvest.booking.security;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import org.springframework.stereotype.Component;

/**
 * Slows down password guessing: after too many failed logins for one email address, or from
 * one IP address, within 15 minutes, further attempts are refused with 429 until the window
 * passes. In memory, which is enough for a single API instance. It throttles instead of locking
 * accounts, so an attacker can only delay a real user by 15 minutes, not lock them out for good.
 * The per-email limit protects each account; the per-IP limit is looser, since many users can
 * share one address (a campus network), and only stops large-scale guessing.
 *
 * It also caps how many logins are checked at once: each password check runs Argon2id with
 * 19 MiB of memory, so a flood of parallel logins could otherwise exhaust the heap. A login that
 * finds no free slot within a short wait is refused (503) without being counted as a failure.
 */
@Component
public class LoginThrottle {

    static final Duration WINDOW = Duration.ofMinutes(15);
    static final int MAX_FAILURES_PER_EMAIL = 5;
    static final int MAX_FAILURES_PER_IP = 100;
    static final int MAX_CONCURRENT_LOGINS = 8;
    static final Duration MAX_LOGIN_WAIT = Duration.ofSeconds(2);

    private record Window(Instant start, int failures) {}

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final Semaphore loginSlots = new Semaphore(MAX_CONCURRENT_LOGINS, true);
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

    /**
     * Takes one of the login slots, waiting at most {@link #MAX_LOGIN_WAIT}. Returns false if none
     * became free. Every successful call must be followed by {@link #leaveLogin()}.
     */
    public boolean enterLogin() {
        try {
            return loginSlots.tryAcquire(MAX_LOGIN_WAIT.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    public void leaveLogin() {
        loginSlots.release();
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
