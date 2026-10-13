package no.vtvest.booking.bootstrap;

import java.io.Console;
import java.lang.reflect.Method;
import java.util.Optional;

/** The operator's interactive terminal. Passwords are read without echo. */
interface Terminal {

    String readLine(String prompt);

    char[] readPassword(String prompt);

    void println(String message);

    /** The process's terminal, or empty if stdin/stdout are not an interactive terminal. */
    static Optional<Terminal> system() {
        Console console = System.console();
        if (console == null) {
            return Optional.empty();
        }
        try {
            // Java 22+ returns a Console even when redirected; isTerminal() tells them apart.
            Method isTerminal = Console.class.getMethod("isTerminal");
            if (!Boolean.TRUE.equals(isTerminal.invoke(console))) {
                return Optional.empty();
            }
        } catch (NoSuchMethodException e) {
            // Java 21: a non-null console is an interactive terminal.
        } catch (ReflectiveOperationException e) {
            return Optional.empty();
        }
        return Optional.of(new Terminal() {
            @Override
            public String readLine(String prompt) {
                return console.readLine("%s", prompt);
            }

            @Override
            public char[] readPassword(String prompt) {
                return console.readPassword("%s", prompt);
            }

            @Override
            public void println(String message) {
                console.writer().println(message);
                console.flush();
            }
        });
    }
}
