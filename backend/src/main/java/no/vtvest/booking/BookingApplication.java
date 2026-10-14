package no.vtvest.booking;

import no.vtvest.booking.bootstrap.BootstrapAdminCli;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BookingApplication {

    public static void main(String[] args) {
        if (args.length > 0 && BootstrapAdminCli.COMMAND.equals(args[0])) {
            // Java 22+ defaults to a JLine-based Console whose readLine(prompt) does not show the
            // prompt in many terminals. The plain console shows prompts and hides passwords. It must be
            // chosen before anything calls System.console().
            System.setProperty("jdk.console", "java.base");
            System.exit(BootstrapAdminCli.run(args));
        }
        SpringApplication.run(BookingApplication.class, args);
    }
}
