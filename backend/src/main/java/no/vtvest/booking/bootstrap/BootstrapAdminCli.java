package no.vtvest.booking.bootstrap;

import java.util.Optional;
import no.vtvest.booking.BookingApplication;
import org.springframework.boot.Banner;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * {@code java -jar app.jar bootstrap-admin}: creates the first SYSTEM_ADMIN from an interactive
 * terminal, then exits. It starts the application without a web server (Flyway still migrates),
 * so it opens no port, and the email and password are only ever typed at the prompt: never
 * arguments or environment variables, which would end up in shell history, process lists or
 * Compose files.
 */
public final class BootstrapAdminCli {

    public static final String COMMAND = "bootstrap-admin";

    private BootstrapAdminCli() {}

    public static int run(String[] args) {
        if (args.length != 1) {
            System.err.println("Bruk: bootstrap-admin (uten flere argumenter; e-post og passord spørres om i terminalen)");
            return BootstrapAdminCommand.USAGE;
        }
        Optional<Terminal> terminal = Terminal.system();
        if (terminal.isEmpty()) {
            System.err.println("bootstrap-admin må kjøres i en interaktiv terminal (for eksempel docker compose run -it).");
            return BootstrapAdminCommand.USAGE;
        }
        try (ConfigurableApplicationContext context = new SpringApplicationBuilder(BookingApplication.class)
                .web(WebApplicationType.NONE)
                .bannerMode(Banner.Mode.OFF)
                .logStartupInfo(false)
                .properties("logging.level.root=WARN")
                .run()) {
            return new BootstrapAdminCommand(terminal.get(), context.getBean(BootstrapAdminService.class)).run();
        }
    }
}
