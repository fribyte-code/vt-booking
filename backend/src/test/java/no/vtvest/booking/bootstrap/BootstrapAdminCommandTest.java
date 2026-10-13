package no.vtvest.booking.bootstrap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The interactive dialogue, with a scripted terminal and no database. */
class BootstrapAdminCommandTest {

    private static final String PASSWORD = "første-admin-passord";

    private final BootstrapAdminService service = mock(BootstrapAdminService.class);

    /** Answers prompts in order and records everything printed or asked. */
    private static final class ScriptedTerminal implements Terminal {
        final Deque<String> answers = new ArrayDeque<>();
        final List<String> output = new ArrayList<>();
        final List<char[]> passwordsHandedOut = new ArrayList<>();

        ScriptedTerminal(String... answers) {
            this.answers.addAll(List.of(answers));
        }

        @Override
        public String readLine(String prompt) {
            output.add(prompt);
            return answers.poll();
        }

        @Override
        public char[] readPassword(String prompt) {
            output.add(prompt);
            String answer = answers.poll();
            if (answer == null) return null;
            char[] chars = answer.toCharArray();
            passwordsHandedOut.add(chars);
            return chars;
        }

        @Override
        public void println(String message) {
            output.add(message);
        }
    }

    @Test
    void createsTheAdminAndWipesThePasswordBuffers() {
        when(service.createFirstAdmin("vt@example.test", "Kari Admin", PASSWORD)).thenReturn(UUID.randomUUID());
        ScriptedTerminal terminal = new ScriptedTerminal("vt@example.test", "Kari Admin", PASSWORD, PASSWORD);

        assertThat(new BootstrapAdminCommand(terminal, service).run()).isEqualTo(BootstrapAdminCommand.OK);
        verify(service).createFirstAdmin("vt@example.test", "Kari Admin", PASSWORD);
        assertThat(terminal.passwordsHandedOut).allSatisfy(chars -> assertThat(new String(chars)).isEqualTo("\0".repeat(chars.length)));
        assertThat(String.join("\n", terminal.output)).doesNotContain(PASSWORD);
    }

    @Test
    void refusesBeforeAskingAnythingWhenAnAdminExists() {
        when(service.adminExists()).thenReturn(true);
        ScriptedTerminal terminal = new ScriptedTerminal();

        assertThat(new BootstrapAdminCommand(terminal, service).run()).isEqualTo(BootstrapAdminCommand.REFUSED);
        assertThat(terminal.output).noneMatch(line -> line.startsWith("E-post") || line.startsWith("Passord"));
        verify(service, never()).createFirstAdmin(any(), any(), any());
    }

    @Test
    void asksAgainForInvalidInputAndMismatchedPasswords() {
        when(service.createFirstAdmin(any(), any(), any())).thenReturn(UUID.randomUUID());
        ScriptedTerminal terminal = new ScriptedTerminal(
                "ikke-en-epost", "vt@example.test",
                "Kari Admin",
                "kort", PASSWORD, "noe-annet-passord", PASSWORD, PASSWORD);

        assertThat(new BootstrapAdminCommand(terminal, service).run()).isEqualTo(BootstrapAdminCommand.OK);
        assertThat(terminal.output).contains("Ugyldig e-postadresse.", "Passordene er ikke like.");
        verify(service).createFirstAdmin("vt@example.test", "Kari Admin", PASSWORD);
    }

    @Test
    void givesUpAfterThreeBadPasswords() {
        ScriptedTerminal terminal = new ScriptedTerminal("vt@example.test", "Kari Admin", "kort", "kortere", "syvtegn");

        assertThat(new BootstrapAdminCommand(terminal, service).run()).isEqualTo(BootstrapAdminCommand.USAGE);
        verify(service, never()).createFirstAdmin(any(), any(), any());
    }

    @Test
    void reportsARefusalFromTheService() {
        when(service.createFirstAdmin(any(), any(), any()))
                .thenThrow(new BootstrapRefusedException("Det finnes allerede en systemadministrator."));
        ScriptedTerminal terminal = new ScriptedTerminal("vt@example.test", "Kari Admin", PASSWORD, PASSWORD);

        assertThat(new BootstrapAdminCommand(terminal, service).run()).isEqualTo(BootstrapAdminCommand.REFUSED);
        assertThat(terminal.output).contains("Avbrutt: Det finnes allerede en systemadministrator.");
    }

    @Test
    void endOfInputAborts() {
        assertThat(new BootstrapAdminCommand(new ScriptedTerminal(), service).run()).isEqualTo(BootstrapAdminCommand.USAGE);
    }

    @Test
    void cliRefusesArgumentsSoSecretsAreNeverPassedOnTheCommandLine() {
        assertThat(BootstrapAdminCli.run(new String[] {"bootstrap-admin", "--password", "x"}))
                .isEqualTo(BootstrapAdminCommand.USAGE);
    }

    @Test
    void cliRefusesWithoutAnInteractiveTerminal() {
        // Surefire runs tests without a terminal.
        assertThat(BootstrapAdminCli.run(new String[] {"bootstrap-admin"})).isEqualTo(BootstrapAdminCommand.USAGE);
    }
}
