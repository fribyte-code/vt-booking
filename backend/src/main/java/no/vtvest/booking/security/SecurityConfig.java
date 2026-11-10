package no.vtvest.booking.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import no.vtvest.booking.user.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.authentication.logout.HttpStatusReturningLogoutSuccessHandler;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Cookie-based session authentication with email and password, and CSRF protection for the SPA:
 * the server sets an XSRF-TOKEN cookie, and the client echoes it in an X-XSRF-TOKEN header on
 * every state-changing request, including login. The session ID changes on login (session
 * fixation protection, Spring's default). Every failed login gets the same bodiless 401, and
 * repeated failures get 429 ({@link LoginThrottle}).
 *
 * There is no other way in: no development login, no HTTP Basic, and the first administrator
 * is created by the bootstrap-admin command line, which has no HTTP endpoint (and starts the
 * application without a web server, so this configuration is skipped there).
 */
@Configuration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class SecurityConfig {

    private static final String LOGIN_URL = "/api/auth/login";

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, UserRepository users, LoginThrottle throttle, Clock clock,
            @Value("${server.servlet.session.cookie.secure}") boolean secureCookies) throws Exception {
        // The XSRF-TOKEN cookie gets the same Secure flag as the session cookie. Left to itself it
        // follows the request's scheme, which is plain HTTP behind an HTTPS reverse proxy.
        CookieCsrfTokenRepository csrfCookies = CookieCsrfTokenRepository.withHttpOnlyFalse();
        csrfCookies.setCookieCustomizer(cookie -> cookie.secure(secureCookies));
        http
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.GET, "/api/auth/csrf").permitAll()
                        // The public booking request form (/soknad). CSRF still applies.
                        .requestMatchers(HttpMethod.POST, "/api/public/requests").permitAll()
                        .requestMatchers("/error").permitAll()
                        .anyRequest().authenticated())
                .csrf(csrf -> csrf.spa().csrfTokenRepository(csrfCookies))
                .addFilterBefore(new ThrottleFilter(throttle), UsernamePasswordAuthenticationFilter.class)
                .formLogin(form -> form
                        .loginProcessingUrl(LOGIN_URL)
                        .usernameParameter("email")
                        .successHandler((request, response, auth) -> {
                            Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
                            CurrentUser.markSessionAuthenticated(request.getSession(), now);
                            users.recordLogin(UUID.fromString(auth.getName()), now);
                            throttle.recordSuccess(request.getParameter("email"));
                            response.setStatus(HttpStatus.NO_CONTENT.value());
                        })
                        .failureHandler((request, response, e) -> {
                            // Only a wrong email or password counts. Anything else (e.g. the
                            // database is down) is the server's problem, not a guess.
                            if (e instanceof BadCredentialsException || e instanceof UsernameNotFoundException) {
                                throttle.recordFailure(request.getRemoteAddr(), request.getParameter("email"));
                                response.setStatus(HttpStatus.UNAUTHORIZED.value());
                            } else {
                                response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
                            }
                        })
                        .permitAll())
                .logout(logout -> logout
                        .logoutUrl("/api/auth/logout")
                        .logoutSuccessHandler(new HttpStatusReturningLogoutSuccessHandler(HttpStatus.NO_CONTENT)))
                .exceptionHandling(e -> e.authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
                .httpBasic(AbstractHttpConfigurer::disable);
        return http.build();
    }

    /**
     * Refuses login attempts with 429 while the email address or IP address is throttled, and with
     * 503 when too many logins are being checked at once. Runs after the CSRF check.
     */
    private static final class ThrottleFilter extends OncePerRequestFilter {
        private final LoginThrottle throttle;

        ThrottleFilter(LoginThrottle throttle) {
            this.throttle = throttle;
        }

        @Override
        protected boolean shouldNotFilter(HttpServletRequest request) {
            String path = request.getRequestURI().substring(request.getContextPath().length());
            return !("POST".equals(request.getMethod()) && LOGIN_URL.equals(path));
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            if (throttle.isBlocked(request.getRemoteAddr(), request.getParameter("email"))) {
                response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
                response.setHeader("Retry-After", String.valueOf(LoginThrottle.WINDOW.toSeconds()));
                return;
            }
            // The password check (Argon2id, 19 MiB each) runs in the chain: only a few at a time.
            // A login that gets no slot is refused before it is checked, so it is not counted.
            if (!throttle.enterLogin()) {
                response.setStatus(HttpStatus.SERVICE_UNAVAILABLE.value());
                response.setHeader("Retry-After", "5");
                return;
            }
            try {
                chain.doFilter(request, response);
            } finally {
                throttle.leaveLogin();
            }
        }
    }
}
