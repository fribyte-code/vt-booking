package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import no.vtvest.booking.security.LoginThrottle;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.testcontainers.Testcontainers;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.images.builder.Transferable;

/**
 * The client address the login throttle sees, through the real chain: the production
 * {@code frontend/nginx.conf} in the production Nginx image, in front of this application with
 * Tomcat's forwarded-header handling. Only the upstream address in the config is replaced, and
 * the login rate limit removed (see {@link #nginx}). The
 * trusted-proxy settings use {@code frontend/real-ip.conf.template} with the same environment
 * variables as {@code compose.prod.yaml}.
 *
 * Clients must not be able to choose their address with {@code X-Forwarded-For}, and behind the
 * reverse proxy that Nginx is told to trust, clients must still be told apart.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
class ProxyClientAddressIntegrationTest {

    /** LoginThrottle.MAX_FAILURES_PER_IP. */
    private static final int MAX_FAILURES_PER_IP = 30;
    private static final String NGINX_IMAGE = "nginx:1.27-alpine"; // as in frontend/Dockerfile

    private final HttpClient http = HttpClient.newHttpClient();
    private int attempt;

    @LocalServerPort
    int port;

    @Autowired
    LoginThrottle loginThrottle;

    @BeforeEach
    void resetLoginThrottle() {
        loginThrottle.clear();
    }

    @Test
    void forgedForwardedForHeadersDoNotEscapeTheIpLimit() throws Exception {
        try (GenericContainer<?> nginx = nginx(null, null)) {
            for (int i = 0; i < MAX_FAILURES_PER_IP; i++) {
                assertThat(failedLogin(nginx, "X-Forwarded-For", forged())).isEqualTo(401);
            }
            assertThat(failedLogin(nginx, "X-Forwarded-For", forged())).isEqualTo(429);
        }
    }

    @Test
    void withTheProductionDefaultsNoProxyIsTrusted() throws Exception {
        // The defaults of compose.prod.yaml: 127.0.0.1 is never the peer here.
        try (GenericContainer<?> nginx = nginx("127.0.0.1", "X-Forwarded-For")) {
            for (int i = 0; i < MAX_FAILURES_PER_IP; i++) {
                assertThat(failedLogin(nginx, "X-Forwarded-For", forged(), "X-Real-IP", forged())).isEqualTo(401);
            }
            assertThat(failedLogin(nginx, "X-Forwarded-For", forged(), "X-Real-IP", forged())).isEqualTo(429);
        }
    }

    @Test
    void behindTheTrustedProxyClientsAreToldApartByItsHeader() throws Exception {
        // In this test the peer is Docker's gateway, whose address isn't known in advance, so it
        // stands in for the reverse proxy by trusting every address. Production names one proxy.
        try (GenericContainer<?> nginx = nginx("0.0.0.0/0", "X-Real-IP")) {
            for (int i = 0; i < MAX_FAILURES_PER_IP; i++) {
                assertThat(failedLogin(nginx, "X-Real-IP", "198.51.100.1", "X-Forwarded-For", forged())).isEqualTo(401);
            }
            assertThat(failedLogin(nginx, "X-Real-IP", "198.51.100.1", "X-Forwarded-For", forged())).isEqualTo(429);
            // Another client behind the same proxy is not affected.
            assertThat(failedLogin(nginx, "X-Real-IP", "198.51.100.2")).isEqualTo(401);
        }
    }

    /**
     * Nginx with the production config. With {@code trustedProxy}, also with the trusted-proxy
     * template and its two variables, as compose.prod.yaml sets them up.
     */
    private GenericContainer<?> nginx(String trustedProxy, String realIpHeader) throws IOException {
        Testcontainers.exposeHostPorts(port);
        String original = Files.readString(Path.of("../frontend/nginx.conf"));
        String conf = original.replace("http://backend:8080", "http://host.testcontainers.internal:" + port);
        assertThat(conf).isNotEqualTo(original);
        // Nginx's own login rate limit would answer 429 before the API's throttle is reached, and
        // this test is about the address the API sees, so the limit is left out here.
        String rateLimit = "limit_req zone=login burst=10 nodelay;";
        assertThat(conf).contains(rateLimit);
        conf = conf.replace(rateLimit, "");

        GenericContainer<?> nginx = new GenericContainer<>(NGINX_IMAGE)
                .withCopyToContainer(Transferable.of(conf), "/etc/nginx/conf.d/default.conf")
                .withExposedPorts(80);
        if (trustedProxy != null) {
            nginx.withCopyToContainer(
                            Transferable.of(Files.readString(Path.of("../frontend/real-ip.conf.template"))),
                            "/etc/nginx/templates/real-ip.conf.template")
                    .withEnv("TRUSTED_PROXY", trustedProxy)
                    .withEnv("REAL_IP_HEADER", realIpHeader);
        }
        nginx.start();
        return nginx;
    }

    /** A new address on every call, from TEST-NET-3: what an attacker rotating fake addresses sends. */
    private String forged() {
        return "203.0.113." + (attempt % 250 + 1);
    }

    /**
     * A failed login through Nginx with the given extra headers, for a new email address each time
     * so the per-email limit never applies. Returns the status: 401, or 429 when throttled.
     */
    private int failedLogin(GenericContainer<?> nginx, String... headers) throws Exception {
        attempt++;
        HttpRequest.Builder request = HttpRequest.newBuilder(
                        URI.create("http://" + nginx.getHost() + ":" + nginx.getMappedPort(80) + "/api/auth/login"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .header("Cookie", "XSRF-TOKEN=t")
                .header("X-XSRF-TOKEN", "t")
                .POST(HttpRequest.BodyPublishers.ofString("email=nobody-" + attempt + "%40example.test&password=wrong-password"));
        for (int i = 0; i < headers.length; i += 2) {
            request.header(headers[i], headers[i + 1]);
        }
        return http.send(request.build(), HttpResponse.BodyHandlers.discarding()).statusCode();
    }
}
