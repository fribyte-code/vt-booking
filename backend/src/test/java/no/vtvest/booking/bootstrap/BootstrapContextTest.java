package no.vtvest.booking.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;

import no.vtvest.booking.BookingApplication;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * The application context exactly as bootstrap-admin starts it: no web server. It must start,
 * migrate the database and provide the bootstrap service, with no HTTP security or endpoints.
 */
@SpringBootTest(classes = BookingApplication.class, webEnvironment = SpringBootTest.WebEnvironment.NONE)
@Import(BootstrapContextTest.Database.class)
class BootstrapContextTest {

    @TestConfiguration(proxyBeanMethods = false)
    static class Database {
        @Bean
        @ServiceConnection
        PostgreSQLContainer postgres() {
            return new PostgreSQLContainer("postgres:18-alpine");
        }
    }

    @Autowired
    ApplicationContext context;

    @Autowired
    BootstrapAdminService bootstrap;

    @Test
    void startsWithoutAWebServerAndCanBootstrap() {
        assertThat(context).isNotInstanceOf(WebApplicationContext.class);
        assertThat(context.getBeansOfType(SecurityFilterChain.class)).isEmpty();
        assertThat(bootstrap.adminExists()).isFalse();
    }
}
