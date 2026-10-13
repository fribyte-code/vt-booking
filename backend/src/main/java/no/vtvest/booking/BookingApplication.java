package no.vtvest.booking;

import no.vtvest.booking.bootstrap.BootstrapAdminCli;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class BookingApplication {

    public static void main(String[] args) {
        if (args.length > 0 && BootstrapAdminCli.COMMAND.equals(args[0])) {
            System.exit(BootstrapAdminCli.run(args));
        }
        SpringApplication.run(BookingApplication.class, args);
    }
}
