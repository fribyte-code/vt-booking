package no.vtvest.booking.bootstrap;

import java.util.Arrays;
import java.util.UUID;
import java.util.regex.Pattern;
import no.vtvest.booking.security.PasswordPolicy;

/** The interactive dialogue of bootstrap-admin. Returns the process exit code. */
class BootstrapAdminCommand {

    static final int OK = 0;
    static final int REFUSED = 1;
    static final int USAGE = 2;

    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final int ATTEMPTS = 3;

    private final Terminal terminal;
    private final BootstrapAdminService service;

    BootstrapAdminCommand(Terminal terminal, BootstrapAdminService service) {
        this.terminal = terminal;
        this.service = service;
    }

    int run() {
        if (service.adminExists()) {
            terminal.println("Avbrutt: det finnes allerede en systemadministrator. Bootstrap kan bare brukes én gang.");
            return REFUSED;
        }
        terminal.println("Oppretter den første systemadministratoren.");

        String email = ask("E-post: ", value -> {
            if (value.length() > 254 || !EMAIL.matcher(value).matches()) return "Ugyldig e-postadresse.";
            if (service.emailInUse(value)) return "Det finnes allerede en bruker med denne e-postadressen.";
            return null;
        });
        if (email == null) return USAGE;

        String name = ask("Navn: ", value -> value.isEmpty() || value.length() > 120
                        || value.chars().anyMatch(Character::isISOControl)
                ? "Navnet må ha 1 til 120 tegn."
                : null);
        if (name == null) return USAGE;

        String password = askPassword();
        if (password == null) return USAGE;

        try {
            UUID id = service.createFirstAdmin(email, name, password);
            terminal.println("Systemadministrator opprettet (" + id + "). Logg inn med " + email + ".");
            return OK;
        } catch (BootstrapRefusedException e) {
            terminal.println("Avbrutt: " + e.getMessage());
            return REFUSED;
        }
    }

    private interface Check {
        /** Returns an error message, or null if the value is acceptable. */
        String problem(String value);
    }

    private String ask(String prompt, Check check) {
        for (int i = 0; i < ATTEMPTS; i++) {
            String line = terminal.readLine(prompt);
            if (line == null) return null; // end of input
            String value = line.trim();
            String problem = check.problem(value);
            if (problem == null) return value;
            terminal.println(problem);
        }
        terminal.println("For mange forsøk.");
        return null;
    }

    private String askPassword() {
        terminal.println("Passordet må ha " + PasswordPolicy.MIN_LENGTH + " til " + PasswordPolicy.MAX_LENGTH
                + " tegn. Det vises ikke mens du skriver.");
        for (int i = 0; i < ATTEMPTS; i++) {
            char[] first = terminal.readPassword("Passord: ");
            if (first == null) return null;
            char[] second = null;
            try {
                String password = new String(first);
                String problem = PasswordPolicy.problem(password).orElse(null);
                if (problem != null) {
                    terminal.println(problem);
                    continue;
                }
                second = terminal.readPassword("Gjenta passord: ");
                if (second == null) return null;
                if (Arrays.equals(first, second)) return password;
                terminal.println("Passordene er ikke like.");
            } finally {
                Arrays.fill(first, '\0');
                if (second != null) Arrays.fill(second, '\0');
            }
        }
        terminal.println("For mange forsøk.");
        return null;
    }
}
