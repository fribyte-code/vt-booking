package no.vtvest.booking.booking;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class CalendarExportTest {

    @Test
    void escapesTextValues() {
        assertThat(CalendarExport.text("a,b;c\\d\r\ne\nf")).isEqualTo("a\\,b\\;c\\\\d\\ne\\nf");
    }

    @Test
    void foldsLongLinesAt75OctetsWithoutSplittingCharacters() {
        StringBuilder ics = new StringBuilder();
        String value = "SUMMARY:" + "ø".repeat(60);
        CalendarExport.line(ics, value);

        String[] lines = ics.toString().split("\r\n");
        for (String line : lines) {
            assertThat(line.getBytes(StandardCharsets.UTF_8).length).isLessThanOrEqualTo(75);
        }
        assertThat(ics.toString().replace("\r\n ", "")).isEqualTo(value + "\r\n");
    }
}
