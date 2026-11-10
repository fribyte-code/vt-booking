-- Test-only fixture data, loaded before every integration test (see IntegrationTest).
-- It replaces the whole data set each time, so tests are isolated from each other.
-- Never used outside the tests: the application has no seed data.
-- Every user's password is IntegrationTest.PASSWORD ("fixture-passord-2026").

TRUNCATE public_request_contacts, room_opening_hours, public_requests, membership_invitations, bookings, room_access, memberships, rooms, organizations, users;

INSERT INTO organizations (id, name) VALUES
    ('10000000-0000-0000-0000-00000000000a', 'Organisasjon A'),
    ('10000000-0000-0000-0000-00000000000b', 'Organisasjon B'),
    ('10000000-0000-0000-0000-00000000000c', 'Organisasjon C');

INSERT INTO users (id, email, display_name, global_role, status, password_hash, password_changed_at) VALUES
    ('20000000-0000-0000-0000-000000000001', 'kari@example.test',   'Kari Nordmann', 'USER', 'ACTIVE',
     '{argon2}$argon2id$v=19$m=19456,t=2,p=1$kwxC5odEhb0S4E0rPMCihg$+scAhIZvhg0XDkHNdDU9Q/an9FKQq/sUEqTO4eWTN0s', now()),
    ('20000000-0000-0000-0000-000000000002', 'ola@example.test',    'Ola Hansen',    'USER', 'ACTIVE',
     '{argon2}$argon2id$v=19$m=19456,t=2,p=1$kwxC5odEhb0S4E0rPMCihg$+scAhIZvhg0XDkHNdDU9Q/an9FKQq/sUEqTO4eWTN0s', now()),
    ('20000000-0000-0000-0000-000000000003', 'ingrid@example.test', 'Ingrid Berg',   'USER', 'ACTIVE',
     '{argon2}$argon2id$v=19$m=19456,t=2,p=1$kwxC5odEhb0S4E0rPMCihg$+scAhIZvhg0XDkHNdDU9Q/an9FKQq/sUEqTO4eWTN0s', now()),
    ('20000000-0000-0000-0000-000000000004', 'jonas@example.test',  'Jonas Lie',     'USER', 'ACTIVE',
     '{argon2}$argon2id$v=19$m=19456,t=2,p=1$kwxC5odEhb0S4E0rPMCihg$+scAhIZvhg0XDkHNdDU9Q/an9FKQq/sUEqTO4eWTN0s', now()),
    ('20000000-0000-0000-0000-000000000005', 'admin@example.test',  'Silje Aas',     'SYSTEM_ADMIN', 'ACTIVE',
     '{argon2}$argon2id$v=19$m=19456,t=2,p=1$kwxC5odEhb0S4E0rPMCihg$+scAhIZvhg0XDkHNdDU9Q/an9FKQq/sUEqTO4eWTN0s', now());

INSERT INTO memberships (user_id, organization_id, role) VALUES
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'MEMBER'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000b', 'MEMBER'),
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000c', 'MEMBER'),
    ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000a', 'ORG_ADMIN'),
    ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000c', 'MEMBER');

INSERT INTO rooms (id, name, description, location, capacity, color) VALUES
    ('30000000-0000-0000-0000-00000000000a', 'Møterom A', 'Lite møterom med skjerm og whiteboard.', '2. etasje', 8,   '#2563eb'),
    ('30000000-0000-0000-0000-00000000000b', 'Møterom B', 'Møterom med videokonferanseutstyr.',     '2. etasje', 12,  '#0f766e'),
    ('30000000-0000-0000-0000-00000000000c', 'Storsalen', 'Stor sal med scene, lydanlegg og projektor.', '1. etasje', 150, '#7c3aed');

INSERT INTO room_access (room_id, organization_id, permission) VALUES
    ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000a', 'DIRECT'),
    ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b', 'DIRECT'),
    ('30000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000c', 'NONE'),
    ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000a', 'REQUEST'),
    ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000b', 'NONE'),
    ('30000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-00000000000c', 'DIRECT'),
    ('30000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000a', 'REQUEST'),
    ('30000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000b', 'REQUEST'),
    ('30000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-00000000000c', 'REQUEST');
