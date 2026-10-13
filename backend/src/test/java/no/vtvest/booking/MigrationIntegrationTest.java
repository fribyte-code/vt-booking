package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

/** V3 on a database that already has V1–V2 data: nothing is lost, and nobody gains a login (no password). */
class MigrationIntegrationTest extends IntegrationTest {

    @Autowired
    DataSource dataSource;

    @Test
    void v3KeepsExistingUsersAndBookingsButGivesNobodyAPassword() {
        String schema = "migration_test";
        jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        Flyway.configure().dataSource(dataSource).schemas(schema).target("2").load().migrate();

        jdbc.update("INSERT INTO " + schema + ".users (id, email, display_name, global_role) VALUES "
                + "('00000000-0000-0000-0000-000000000001', 'old-admin@example.test', 'Gammel admin', 'ADMIN'), "
                + "('00000000-0000-0000-0000-000000000002', 'old-user@example.test', 'Gammel bruker', 'USER')");
        jdbc.update("INSERT INTO " + schema + ".organizations (id, name) VALUES ('00000000-0000-0000-0000-0000000000aa', 'Org')");
        jdbc.update("INSERT INTO " + schema + ".rooms (id, name, color) VALUES ('00000000-0000-0000-0000-0000000000bb', 'Rom', '#123456')");
        jdbc.update("INSERT INTO " + schema + ".bookings (room_id, organization_id, requested_by_id, title, start_at, end_at, status, requires_approval) "
                + "VALUES ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-0000000000aa', "
                + "'00000000-0000-0000-0000-000000000002', 'Gammel booking', now() + interval '1 day', now() + interval '25 hours', 'APPROVED', false)");

        Flyway.configure().dataSource(dataSource).schemas(schema).load().migrate();

        assertThat(jdbc.queryForList("SELECT email, global_role, status, password_hash FROM " + schema + ".users ORDER BY email"))
                .extracting(row -> row.get("email") + " " + row.get("global_role") + " " + row.get("status") + " " + row.get("password_hash"))
                .containsExactly(
                        "old-admin@example.test SYSTEM_ADMIN ACTIVE null",
                        "old-user@example.test USER ACTIVE null");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM " + schema + ".bookings", Integer.class)).isEqualTo(1);

        assertThatThrownBy(() -> jdbc.update("UPDATE " + schema + ".users SET global_role = 'ADMIN'"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("UPDATE " + schema + ".users SET status = 'INVITED'"))
                .isInstanceOf(DataIntegrityViolationException.class);

        jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }
}
