-- Core schema: users, organizations, memberships, rooms, room access and bookings.
-- See docs/DATABASE_DESIGN.md. Enum-like columns use CHECK constraints instead of
-- PostgreSQL ENUM types so that adding a value is a simple migration.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email        varchar(254) NOT NULL,
    display_name varchar(120) NOT NULL,
    global_role  varchar(10)  NOT NULL DEFAULT 'USER' CHECK (global_role IN ('USER', 'ADMIN')),
    created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE organizations (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       varchar(120) NOT NULL,
    status     varchar(10)  NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX organizations_name_uq ON organizations (lower(name));

CREATE TABLE memberships (
    user_id         uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES organizations ON DELETE RESTRICT,
    role            varchar(10) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MEMBER', 'ORG_ADMIN')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, organization_id)
);
CREATE INDEX memberships_organization_idx ON memberships (organization_id);

CREATE TABLE rooms (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               varchar(80)   NOT NULL,
    description        varchar(1000),
    location           varchar(120),
    capacity           integer CHECK (capacity > 0),
    color              varchar(7)    NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
    status             varchar(10)   NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')),
    -- Applies to organizations without a room_access row.
    default_permission varchar(10)   NOT NULL DEFAULT 'NONE' CHECK (default_permission IN ('DIRECT', 'REQUEST', 'NONE')),
    created_at         timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rooms_name_uq ON rooms (lower(name));

CREATE TABLE room_access (
    room_id         uuid NOT NULL REFERENCES rooms ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
    permission      varchar(10) NOT NULL CHECK (permission IN ('DIRECT', 'REQUEST', 'NONE')),
    PRIMARY KEY (room_id, organization_id)
);
CREATE INDEX room_access_organization_idx ON room_access (organization_id);

CREATE TABLE bookings (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id           uuid NOT NULL REFERENCES rooms,
    organization_id   uuid NOT NULL REFERENCES organizations,
    requested_by_id   uuid NOT NULL REFERENCES users,
    title             varchar(80)  NOT NULL CHECK (btrim(title) <> ''),
    description       varchar(500),
    start_at          timestamptz  NOT NULL,
    end_at            timestamptz  NOT NULL,
    period            tstzrange GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED,
    status            varchar(10)  NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    requires_approval boolean      NOT NULL,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    version           integer      NOT NULL DEFAULT 0,

    CONSTRAINT bookings_end_after_start CHECK (end_at > start_at),
    -- The double-booking guarantee: no two APPROVED bookings may overlap in the same room,
    -- including under concurrent transactions. Half-open ranges allow back-to-back bookings.
    CONSTRAINT bookings_no_overlap
        EXCLUDE USING gist (room_id WITH =, period WITH &&) WHERE (status = 'APPROVED')
);
CREATE INDEX bookings_room_period_idx ON bookings USING gist (room_id, period)
    WHERE status IN ('APPROVED', 'PENDING');
CREATE INDEX bookings_organization_start_idx ON bookings (organization_id, start_at);
CREATE INDEX bookings_requester_start_idx ON bookings (requested_by_id, start_at);
