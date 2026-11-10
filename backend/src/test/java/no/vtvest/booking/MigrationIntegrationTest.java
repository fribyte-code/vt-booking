package no.vtvest.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * Migrations that change or add data: V3 (nobody gains a login), V7 (the shared external
 * organization), V8 (event names) and V9 (requested rooms instead of areas).
 */
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

    @Test
    void v7CreatesTheSharedExternalOrganizationOnceWithoutMembersOrAccess() {
        String schema = "migration_test_v7";
        jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        Flyway.configure().dataSource(dataSource).schemas(schema).load().migrate();

        assertThat(jdbc.queryForList("SELECT name, status FROM " + schema + ".organizations"))
                .extracting(row -> row.get("name") + " " + row.get("status"))
                .containsExactly("Eksterne ACTIVE");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM " + schema + ".memberships", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM " + schema + ".room_access", Integer.class)).isZero();
        jdbc.execute("DROP SCHEMA " + schema + " CASCADE");

        // An organization an admin already created with that name is kept, not duplicated.
        Flyway.configure().dataSource(dataSource).schemas(schema).target("6").load().migrate();
        jdbc.update("INSERT INTO " + schema + ".organizations (name) VALUES ('EKSTERNE')");
        Flyway.configure().dataSource(dataSource).schemas(schema).load().migrate();
        assertThat(jdbc.queryForList("SELECT name FROM " + schema + ".organizations", String.class)).containsExactly("EKSTERNE");
        jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }

    @Test
    void v8GivesExistingPublicRequestsTheirOrganizationNameAsEventName() {
        String schema = "migration_test_v8";
        jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        Flyway.configure().dataSource(dataSource).schemas(schema).target("7").load().migrate();
        jdbc.update("INSERT INTO " + schema + ".public_requests (email, organization_name, member_of_kulturstyret_or_samfunnet, "
                + "start_at, end_at, description, needs_villa_guard) VALUES "
                + "('a@example.test', 'Kort navn', true, now() + interval '1 day', now() + interval '25 hours', 'Fest', false), "
                + "('b@example.test', ?, false, now() + interval '1 day', now() + interval '25 hours', 'Fest', true)", "x".repeat(120));

        Flyway.configure().dataSource(dataSource).schemas(schema).load().migrate();

        assertThat(jdbc.queryForList("SELECT event_name FROM " + schema + ".public_requests ORDER BY email", String.class))
                .containsExactly("Kort navn", "x".repeat(80));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM " + schema + ".public_requests", Integer.class)).isEqualTo(2);
        assertThatThrownBy(() -> jdbc.update("UPDATE " + schema + ".public_requests SET event_name = ' '"))
                .isInstanceOf(DataIntegrityViolationException.class);
        jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }

    @Test
    void v9OffersTheTwoCommonAreasAndTurnsRequestedAreasIntoRooms() {
        String schema = "migration_test_v9";
        jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        Flyway.configure().dataSource(dataSource).schemas(schema).target("8").load().migrate();
        jdbc.update("INSERT INTO " + schema + ".rooms (id, name, color) VALUES "
                + "('00000000-0000-0000-0000-0000000000f1', ' festplassen ', '#123456'), "
                + "('00000000-0000-0000-0000-0000000000f2', 'Møterom', '#123456')");
        jdbc.update("INSERT INTO " + schema + ".public_requests (email, organization_name, event_name, member_of_kulturstyret_or_samfunnet, "
                + "start_at, end_at, description, needs_villa_guard, preferred_area) VALUES "
                + "('a@example.test', 'Org', 'Fest', true, now() + interval '1 day', now() + interval '25 hours', 'Fest', true, 'FESTPLASSEN'), "
                + "('b@example.test', 'Org', 'Fest', true, now() + interval '1 day', now() + interval '25 hours', 'Fest', true, 'TORGALLMENNINGEN'), "
                + "('c@example.test', 'Org', 'Fest', true, now() + interval '1 day', now() + interval '25 hours', 'Fest', false, 'NO_PREFERENCE')");

        Flyway.configure().dataSource(dataSource).schemas(schema).load().migrate();

        assertThat(jdbc.queryForList("SELECT name, public_requestable FROM " + schema + ".rooms ORDER BY name"))
                .extracting(row -> row.get("name") + " " + row.get("public_requestable"))
                .containsExactly(" festplassen  true", "Møterom false");
        // Torgallmenningen doesn't exist as a room here: the name is kept without an id.
        assertThat(jdbc.queryForList("SELECT email, preferred_room_id, preferred_room_name FROM " + schema + ".public_requests ORDER BY email"))
                .extracting(row -> row.get("email") + " " + row.get("preferred_room_id") + " " + row.get("preferred_room_name"))
                .containsExactly(
                        "a@example.test 00000000-0000-0000-0000-0000000000f1 Festplassen",
                        "b@example.test null Torgallmenningen",
                        "c@example.test null null");
        jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }

    @Test
    void v10TurnsTransferredRequestsIntoDone() {
        String schema = "migration_test_v10";
        jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        Flyway.configure().dataSource(dataSource).schemas(schema).target("9").load().migrate();
        jdbc.update("INSERT INTO " + schema + ".public_requests (email, organization_name, event_name, member_of_kulturstyret_or_samfunnet, "
                + "start_at, end_at, description, status) VALUES "
                + "('a@example.test', 'Org', 'Fest', true, now() + interval '1 day', now() + interval '25 hours', 'Fest', 'TRANSFERRED'), "
                + "('b@example.test', 'Org', 'Fest', true, now() + interval '1 day', now() + interval '25 hours', 'Fest', 'NEW')");

        Flyway.configure().dataSource(dataSource).schemas(schema).load().migrate();

        assertThat(jdbc.queryForList("SELECT status FROM " + schema + ".public_requests ORDER BY email", String.class))
                .containsExactly("DONE", "NEW");
        assertThatThrownBy(() -> jdbc.update("UPDATE " + schema + ".public_requests SET status = 'TRANSFERRED'"))
                .isInstanceOf(DataIntegrityViolationException.class);
        jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }

    @Test
    void v11ReleasesRequestsWhoseBookingIsGoneAndTheTriggerWorksInTheMigratedSchema() {
        String schema = "migration_test_v11";
        jdbc.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        Flyway.configure().dataSource(dataSource).schemas(schema).target("10").load().migrate();
        jdbc.update("INSERT INTO " + schema + ".users (id, email, display_name) VALUES ('00000000-0000-0000-0000-000000000001', 'a@example.test', 'A')");
        jdbc.update("INSERT INTO " + schema + ".organizations (id, name) VALUES ('00000000-0000-0000-0000-0000000000aa', 'Org')");
        jdbc.update("INSERT INTO " + schema + ".rooms (id, name, color) VALUES ('00000000-0000-0000-0000-0000000000bb', 'Rom', '#123456')");
        String booking = "INSERT INTO " + schema + ".bookings (id, room_id, organization_id, requested_by_id, title, start_at, end_at, status, "
                + "requires_approval, cancelled_at, cancelled_by_id) VALUES (?::uuid, '00000000-0000-0000-0000-0000000000bb', "
                + "'00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000001', 'Fest', "
                + "now() + interval '1 day', now() + interval '25 hours', ?, false, ?::timestamptz, ?::uuid)";
        jdbc.update(booking, "00000000-0000-0000-0000-0000000000c1", "CANCELLED", "2026-01-01T00:00:00Z", "00000000-0000-0000-0000-000000000001");
        jdbc.update(booking, "00000000-0000-0000-0000-0000000000c2", "APPROVED", null, null);
        String request = "INSERT INTO " + schema + ".public_requests (email, organization_name, event_name, member_of_kulturstyret_or_samfunnet, "
                + "start_at, end_at, description, status, booking_id) VALUES (?, 'Org', 'Fest', true, now() + interval '1 day', "
                + "now() + interval '25 hours', 'Fest', 'DONE', ?::uuid)";
        jdbc.update(request, "a@example.test", "00000000-0000-0000-0000-0000000000c1");
        jdbc.update(request, "b@example.test", "00000000-0000-0000-0000-0000000000c2");

        Flyway.configure().dataSource(dataSource).schemas(schema).load().migrate();

        assertThat(jdbc.queryForList("SELECT email, status, booking_id IS NULL AS released, booking_removed_at FROM " + schema
                        + ".public_requests ORDER BY email"))
                .extracting(row -> row.get("email") + " " + row.get("status") + " " + row.get("released") + " " + (row.get("booking_removed_at") != null))
                .containsExactly("a@example.test IN_PROGRESS true true", "b@example.test DONE false false");

        // The session's search_path is public here; the trigger still updates the migrated schema.
        jdbc.update("UPDATE " + schema + ".bookings SET status = 'CANCELLED', cancelled_at = now(), "
                + "cancelled_by_id = '00000000-0000-0000-0000-000000000001' WHERE id = '00000000-0000-0000-0000-0000000000c2'");
        assertThat(jdbc.queryForObject("SELECT status FROM " + schema + ".public_requests WHERE email = 'b@example.test'", String.class))
                .isEqualTo("IN_PROGRESS");
        jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }
}
