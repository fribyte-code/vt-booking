# Database Design

Preliminary PostgreSQL schema. **Status:** proposal for review. Labels (REQ/REC/ASM) are explained in [`ARCHITECTURE.md`](ARCHITECTURE.md).

The database is the **last line of defence** for integrity. The service layer gives friendly errors, and the database guarantees that bad states cannot exist, even under concurrency or when there are bugs. This addresses audit findings RISK-01, VULN-06, RISK-06 and C-5.

---

## 1. Design principles

- **PostgreSQL 18** (17 also works; we use built-in `uuidv7()` on 18, or `gen_random_uuid()` on 17).
- **Extensions:** `btree_gist` (exclusion constraint on `uuid =`) and `citext` (case-insensitive emails).
- **Primary keys:** UUID, generated in the DB (RISK-04). The audit log uses `bigint identity`.
- **Status and enum columns are `text` with `CHECK (... IN (...))`**, not PostgreSQL `ENUM` types. Adding a value is then a simple constraint swap in a migration, and it maps trivially to Java enums.
- **All instants are `timestamptz`.** Wall-clock concepts (opening hours, recurrence times) are `time` and `date`, interpreted in `Europe/Oslo` (§9).
- **Nothing that carries history is hard-deleted.** Bookings, organizations and rooms change status. Users are anonymized. Most FKs are `ON DELETE RESTRICT`.
- **Typed configuration columns, not a generic rules engine or EAV table.** Every booking restriction is a nullable column with a global default (§8).
- **Migrations:** Flyway with plain SQL. Hibernate `ddl-auto=validate` only (§12).

---

## 2. Entity overview

```text
users ──< user_identities
  │
  ├──< memberships >── organizations ──< organization_invitations
  │                         │
  │                         └──< room_access >── rooms ──< room_opening_hours
  │                                                │
  ├──< bookings >──────────── organizations        │
  │       │   └────────────────────────────────────┘ (room_id)
  │       └── booking_series (optional parent)
  ├──< notifications
  ├──< calendar_feeds
  └──< audit_log (actor)

system_settings (single row)      spring_session tables (Spring Session JDBC)
```

| Table | Why it exists | New vs README model |
|---|---|---|
| `users` | Accounts and global role | README |
| `user_identities` | One user can log in with Feide and/or Google | **new**, needed for multi-provider login |
| `organizations` | Organizations, plus quota overrides | README |
| `memberships` | User ↔ org with org role and optional expiry | README (+ role, expiry) |
| `organization_invitations` | Self-service onboarding by org admins | **new**, needed so Velferdstinget doesn't manage all members |
| `rooms` | Rooms, status, default permission, limits | README |
| `room_opening_hours` | Opening hours per weekday | **new** (booking restriction) |
| `room_access` | Per (room, org) permission override | README |
| `booking_series` | Recurrence definition | **new** (recurring bookings) |
| `bookings` | Bookings, requests, admin blocks | README (+ `kind`, `series_id`, `version`) |
| `notifications` | In-app notifications and the email outbox | **new**, replaces the `decisionSeen` flag |
| `calendar_feeds` | Revocable ICS tokens | **new** (iCal) |
| `audit_log` | Accountability for security-relevant events | **new** (C-12) |
| `system_settings` | Global defaults for limits | **new** |

**Rejected on purpose:**

- A separate `fixed_reservations` table, and a separate `room_blocks` table. Both are modelled as bookings (§7).
- An `organization_groups` or permission-templates table. Room defaults and bulk operations cover it for now (§4, Q-16).
- `booking_status_history`. The audit log already records transitions.

---

## 3. Tables (DDL sketch)

> This is a design sketch, not the final migration. Names and limits are proposals. Text limits match the prototype UI (`maxLength` 80/500/300) and audit VULN-06.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

-- ── Users & identity ─────────────────────────────────────────────
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  email          citext UNIQUE,                         -- NULL after anonymization
  display_name   varchar(120) NOT NULL,
  global_role    text NOT NULL DEFAULT 'USER'  CHECK (global_role IN ('USER','ADMIN')),
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','ANONYMIZED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE user_identities (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id        uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  provider       text NOT NULL CHECK (provider IN ('feide','google')),   -- extend via migration
  subject        text NOT NULL,                         -- OIDC "sub": the stable key, never the email
  email          citext,                                -- as asserted at last login
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz,
  UNIQUE (provider, subject)
);
CREATE INDEX ON user_identities (user_id);

-- ── Organizations ────────────────────────────────────────────────
CREATE TABLE organizations (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  name                  varchar(120) NOT NULL,
  short_name            varchar(40),
  description           varchar(1000),
  contact_email         citext,
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  max_future_bookings   int CHECK (max_future_bookings > 0),   -- NULL = system default
  max_pending_requests  int CHECK (max_pending_requests > 0),  -- NULL = system default
  archived_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX organizations_active_name_uq ON organizations (lower(name)) WHERE status = 'ACTIVE';

CREATE TABLE memberships (
  user_id          uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations ON DELETE RESTRICT,
  role             text NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MEMBER','ORG_ADMIN')),
  expires_at       timestamptz,                         -- optional: e.g. end of board term
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by_id    uuid REFERENCES users,
  PRIMARY KEY (user_id, organization_id)
);
CREATE INDEX ON memberships (organization_id);

CREATE TABLE organization_invitations (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  organization_id  uuid NOT NULL REFERENCES organizations,
  email            citext NOT NULL,                     -- where the link was sent
  role             text NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('MEMBER','ORG_ADMIN')),
  token_hash       bytea NOT NULL UNIQUE,               -- SHA-256 of a 256-bit random token
  invited_by_id    uuid NOT NULL REFERENCES users,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  accepted_at      timestamptz,
  accepted_by_id   uuid REFERENCES users,
  revoked_at       timestamptz
);
CREATE INDEX ON organization_invitations (organization_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ── Rooms & access ───────────────────────────────────────────────
CREATE TABLE rooms (
  id                          uuid PRIMARY KEY DEFAULT uuidv7(),
  name                        varchar(80)  NOT NULL,
  description                 varchar(1000),
  building                    varchar(80),              -- grouping in filters
  location                    varchar(120),
  capacity                    int CHECK (capacity > 0),
  color                       char(7) NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),  -- RISK-06
  status                      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','ARCHIVED')),
  default_permission          text NOT NULL DEFAULT 'NONE' CHECK (default_permission IN ('DIRECT','REQUEST','NONE')),
  approval_required           boolean NOT NULL DEFAULT false,  -- caps DIRECT at REQUEST for everyone
  -- Restriction overrides; NULL = use system_settings
  max_duration_minutes        int CHECK (max_duration_minutes > 0),
  max_advance_days            int CHECK (max_advance_days > 0),
  min_notice_minutes          int CHECK (min_notice_minutes >= 0),
  cancellation_deadline_hours int CHECK (cancellation_deadline_hours >= 0),
  sort_order                  int NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rooms_active_name_uq ON rooms (lower(name)) WHERE status <> 'ARCHIVED';

CREATE TABLE room_opening_hours (           -- no rows for a room = no opening-hours restriction
  room_id    uuid NOT NULL REFERENCES rooms ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),   -- ISO: 1 = Monday
  opens_at   time NOT NULL,
  closes_at  time NOT NULL,                  -- '24:00' allowed
  PRIMARY KEY (room_id, weekday, opens_at),
  CHECK (closes_at > opens_at)
);

CREATE TABLE room_access (                  -- per-org override of rooms.default_permission
  room_id          uuid NOT NULL REFERENCES rooms ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
  permission       text NOT NULL CHECK (permission IN ('DIRECT','REQUEST','NONE')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by_id    uuid REFERENCES users,
  PRIMARY KEY (room_id, organization_id)
);
CREATE INDEX ON room_access (organization_id);

-- ── Bookings ─────────────────────────────────────────────────────
CREATE TABLE booking_series (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  kind             text NOT NULL DEFAULT 'BOOKING' CHECK (kind IN ('BOOKING','BLOCK')),
  room_id          uuid NOT NULL REFERENCES rooms,
  organization_id  uuid REFERENCES organizations,
  requested_by_id  uuid NOT NULL REFERENCES users,
  title            varchar(80) NOT NULL,
  description      varchar(500),
  interval_weeks   smallint NOT NULL DEFAULT 1 CHECK (interval_weeks BETWEEN 1 AND 4),
  weekdays         smallint[] NOT NULL CHECK (cardinality(weekdays) BETWEEN 1 AND 7
                                              AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  start_time       time NOT NULL,
  end_time         time NOT NULL,             -- local wall clock in Europe/Oslo
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (end_time > start_time),
  CHECK ((kind = 'BOOKING') = (organization_id IS NOT NULL))
);

CREATE TABLE bookings (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  kind                text NOT NULL DEFAULT 'BOOKING' CHECK (kind IN ('BOOKING','BLOCK')),
  room_id             uuid NOT NULL REFERENCES rooms,
  organization_id     uuid REFERENCES organizations,
  series_id           uuid REFERENCES booking_series,
  requested_by_id     uuid NOT NULL REFERENCES users,
  title               varchar(80) NOT NULL CHECK (btrim(title) <> ''),
  description         varchar(500),
  expected_attendees  int CHECK (expected_attendees > 0),
  start_at            timestamptz NOT NULL,
  end_at              timestamptz NOT NULL,
  period              tstzrange GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED,
  status              text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  requires_approval   boolean NOT NULL,
  decided_at          timestamptz,
  decided_by_id       uuid REFERENCES users,
  decision_comment    varchar(300),
  cancelled_at        timestamptz,
  cancelled_by_id     uuid REFERENCES users,
  cancellation_reason varchar(300),
  version             int NOT NULL DEFAULT 0,   -- JPA @Version; also ICS SEQUENCE
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CHECK (end_at > start_at),
  CHECK ((kind = 'BOOKING') = (organization_id IS NOT NULL)),          -- blocks have no org
  CHECK (kind = 'BOOKING' OR status IN ('APPROVED','CANCELLED')),      -- blocks are never requests
  CHECK (status <> 'REJECTED'  OR decided_at  IS NOT NULL),
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL),

  -- The double-booking guarantee (RISK-01). Blocks and bookings share it.
  CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (room_id WITH =, period WITH &&) WHERE (status = 'APPROVED')
);

-- Calendar range queries (approved + pending), by room
CREATE INDEX bookings_room_period_active_idx ON bookings USING gist (room_id, period)
  WHERE status IN ('APPROVED','PENDING');
-- "My bookings", "org bookings", admin history, series operations
CREATE INDEX bookings_requester_start_idx ON bookings (requested_by_id, start_at DESC);
CREATE INDEX bookings_org_start_idx       ON bookings (organization_id, start_at DESC);
CREATE INDEX bookings_pending_idx         ON bookings (start_at) WHERE status = 'PENDING';
CREATE INDEX bookings_decided_idx         ON bookings (decided_at DESC) WHERE decided_at IS NOT NULL;
CREATE INDEX bookings_series_idx          ON bookings (series_id) WHERE series_id IS NOT NULL;
-- VULN-05: the same user cannot file an identical pending request twice
CREATE UNIQUE INDEX bookings_pending_duplicate_uq
  ON bookings (requested_by_id, room_id, start_at, end_at) WHERE status = 'PENDING';

-- ── Notifications, feeds, audit, settings ────────────────────────
CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  type            text NOT NULL,             -- REQUEST_APPROVED, REQUEST_REJECTED, BOOKING_CANCELLED_BY_ADMIN, NEW_REQUEST (admins), INVITED, ...
  booking_id      uuid REFERENCES bookings,
  data            jsonb NOT NULL DEFAULT '{}', -- small render payload (title, room name, times)
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz,
  email_status    text NOT NULL DEFAULT 'NOT_REQUIRED'
                  CHECK (email_status IN ('NOT_REQUIRED','PENDING','SENT','FAILED')),
  email_attempts  smallint NOT NULL DEFAULT 0,
  email_sent_at   timestamptz
);
CREATE INDEX notifications_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_outbox_idx ON notifications (created_at) WHERE email_status = 'PENDING';

CREATE TABLE calendar_feeds (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id          uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  scope            text NOT NULL CHECK (scope IN ('ROOM','ORGANIZATION','PERSONAL')),
  room_id          uuid REFERENCES rooms,
  organization_id  uuid REFERENCES organizations,
  include_pending  boolean NOT NULL DEFAULT false,
  token_hash       bytea NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz,
  revoked_at       timestamptz,
  CHECK ((scope = 'ROOM') = (room_id IS NOT NULL)),
  CHECK ((scope = 'ORGANIZATION') = (organization_id IS NOT NULL))
);

CREATE TABLE audit_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  actor_user_id    uuid REFERENCES users,      -- NULL = system job
  action           text NOT NULL,              -- e.g. BOOKING_APPROVED, ROOM_ACCESS_CHANGED, MEMBER_REMOVED, LOGIN
  entity_type      text NOT NULL,
  entity_id        text NOT NULL,
  organization_id  uuid,                       -- for org-scoped filtering; no FK on purpose (history)
  details          jsonb NOT NULL DEFAULT '{}', -- before/after for changed fields; no free text from users
  request_id       text
);
CREATE INDEX ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX ON audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX ON audit_log (occurred_at DESC);

CREATE TABLE system_settings (               -- exactly one row
  id                              boolean PRIMARY KEY DEFAULT true CHECK (id),
  max_duration_minutes            int NOT NULL DEFAULT 720,   -- 12 h
  max_advance_days                int NOT NULL DEFAULT 180,
  min_notice_minutes              int NOT NULL DEFAULT 0,
  cancellation_deadline_hours     int NOT NULL DEFAULT 0,
  max_pending_requests_per_user   int NOT NULL DEFAULT 10,
  max_pending_requests_per_org    int NOT NULL DEFAULT 25,
  max_future_bookings_per_org     int NOT NULL DEFAULT 50,
  max_series_occurrences          int NOT NULL DEFAULT 30,
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  updated_by_id                   uuid REFERENCES users
);
```

Spring Session JDBC adds its own two tables (`spring_session`, `spring_session_attributes`). Their DDL ships with Spring Session and is copied into a Flyway migration.

---

## 4. Room permissions at scale

**REQ:** support dozens or hundreds of organizations and many rooms.

The effective permission rule is in `ARCHITECTURE.md` §5. In short: `room_access` override, else `rooms.default_permission`, capped by `approval_required`, and `NONE` if the room or org is not active.

**Why this is enough without templates (REC):**

- **Typical rooms need 0–5 rows.** "Storsalen: everyone REQUEST" needs no rows, only `default_permission = 'REQUEST'`. "Møterom A: DIRECT for 3 orgs, REQUEST for the rest" needs `default = REQUEST` plus 3 rows.
- **Explicit `NONE` rows** exclude a specific org from a room that is open by default.
- **"Approval required" is a room switch.** For example, during exam periods it temporarily makes everyone REQUEST, without touching individual rows.
- **Bulk operations live in the API, not the schema.** "Set permission P for orgs [..] on rooms [..]" and "copy room A's overrides to room B" are single transactions of `INSERT ... ON CONFLICT DO UPDATE`.
- **Lookup cost** for "which rooms can org X book" is a `LEFT JOIN` of rooms with `room_access` for one org. That is trivial at our size.

**Upgrade path if it isn't enough (postponed, Q-16).**

- Add `organization_categories` (for example "linjeforening", "kultur", "idrett") and an extra fallback level: org override, then category permission, then room default.
- That is one table and one extra step in `EffectivePermission`. No other code changes.

---

## 5. Booking conflict strategy

### Layers

| Layer | Purpose | Guarantees? |
|---|---|---|
| SPA prechecks | Show "looks busy" instantly from loaded calendar data | No |
| `POST /bookings/preview` and the service check | Friendly error that names the conflicting booking, with visibility rules applied | No (it races) |
| **`bookings_no_overlap` exclusion constraint** | Two `APPROVED` rows for the same room with overlapping `[start, end)` cannot exist. This holds for concurrent transactions too, because GiST exclusion checks are atomic and lock-aware. | **Yes** |

### Details

- **Half-open intervals `[)`**: back-to-back bookings (10–11, 11–12) are allowed. This matches the prototype's `findConflicts`.
- **Only `APPROVED` blocks**, matching the prototype's `blocksAvailability`. Blocks (`kind = 'BLOCK'`) are `APPROVED`, so they participate automatically.
- **Error mapping:** SQLState `23P01` (exclusion_violation) → `409 CONFLICT`. The service then re-queries the overlapping booking to build the message.
- **Pending requests do not reserve the slot (provisional REQ, Q-03).** If Velferdstinget decides they should, the change is a migration that alters the predicate to `WHERE (status IN ('APPROVED','PENDING'))`, after resolving existing overlapping pendings. No application redesign is needed. Keep this in mind, but don't build for it.

### Transactions per operation

**Create** (single booking):

```text
BEGIN
  SELECT ... FROM organizations WHERE id = :org FOR UPDATE      -- serializes quota checks per org
  load membership, effective permission, room limits, counts    -- all rules (BookingRules)
  INSERT INTO bookings (... status = APPROVED | PENDING ...)    -- 23P01 → 409 if APPROVED overlaps
  INSERT INTO audit_log ...; INSERT INTO notifications ...      -- same transaction (outbox)
COMMIT
```

The org row lock makes the quota checks ("max N pending") exact under concurrency. It is cheap because contention is only within one organization.

**Approve:**

```text
BEGIN
  SELECT * FROM bookings WHERE id = :id FOR UPDATE
  require status = PENDING and version = :expectedVersion       -- else 409 INVALID_STATE / VERSION_CONFLICT
  require start_at > now()
  require requester still member of organization                -- VULN-04
  require effective permission(room, org) IN (DIRECT, REQUEST)  -- VULN-04
  require room and org ACTIVE
  UPDATE bookings SET status = 'APPROVED', decided_* , version = version + 1
                                                                -- 23P01 → 409 CONFLICT
  audit + notification
COMMIT
```

Two admins approving overlapping requests at the same moment: one commits, and the other gets `23P01`, which becomes `409`. That covers the second half of RISK-01.

**Reschedule** (drag/resize, `PATCH`):

- `UPDATE ... SET start_at, end_at WHERE id = :id AND version = :v`. The constraint re-checks automatically.
- The rules (duration, opening hours, horizon) run before the update. See `API_DESIGN.md` for who may reschedule what.

**Cancel:**

- Update the status with a version check. The slot frees immediately, because the constraint ignores `CANCELLED` rows.

**Optimistic locking (`version`).**

- It protects against concurrent *different* transitions on the same row, for example cancel and approve at once, or two admins editing.
- The exclusion constraint protects against overlaps across rows.
- We need both.

---

## 6. Recurring bookings

**REC: materialize occurrences.** A series is a *definition* (`booking_series`). Creating it inserts **one `bookings` row per occurrence**, linked by `series_id`.

**Why materialize instead of storing an RRULE and expanding at read time:**

- The exclusion constraint, quotas, approval, cancellation, ICS and calendar queries all work per row, unchanged.
- Per-occurrence exceptions are trivial. Cancelling one week is a status change on one row, with no `EXDATE` bookkeeping.
- A bounded horizon keeps row counts small: `max_series_occurrences` (default 30) is about one semester weekly.

**Deliberately limited recurrence model (REC):**

- Weekly, every 1–4 weeks, on chosen weekdays, between `start_date` and `end_date`. That covers board meetings, rehearsals and weekly practice.
- No monthly, "last Thursday", or full RFC 5545 RRULE. These are rare for room booking and would be expensive to validate and explain.
- The `end_date` is required and bounded by `max_advance_days` and `max_series_occurrences`. No infinite series. Organizations renew each semester (Q-12).

**Expansion and validation:**

1. Expand dates in `Europe/Oslo`, then combine each with `start_time`/`end_time` and convert to `timestamptz`. 18:00 stays 18:00 across DST changes.
2. Run the full `BookingRules` on **each** occurrence (permission, limits, opening hours, conflicts). Quotas count a series as N bookings, or as one; see Q-12. Default: one for quota purposes, capped by `max_series_occurrences`.
3. Conflict policy, chosen by the client after a preview:
   - `FAIL_IF_ANY`: insert nothing if any occurrence fails.
   - `SKIP_CONFLICTS`: insert the occurrences that pass, and return the skipped ones.
4. Everything runs in one transaction. If a concurrent insert makes an occurrence fail with `23P01` *after* the precheck, the whole transaction rolls back and the API retries once, re-running the precheck. This is simpler than savepoints per row, and rare at our load.

**Status:** with `DIRECT` permission, the occurrences are `APPROVED`. With `REQUEST`, they are `PENDING`. An admin can approve the whole series, which approves the non-conflicting occurrences and reports the rest, or approve or reject individual occurrences.

**Edits:**

- Title and description edits apply to all future occurrences.
- Time changes are "cancel future occurrences, then create a new series". That is honest and simple, and avoids complex series-diff logic.
- "Avlys denne og senere" sets `CANCELLED` on future occurrences. The `booking_series` row stays as history.

---

## 7. Fixed reservations and room blocks

The README's "Faste tider / rom" can mean two different things. We support the common case simply and postpone the complex one (Q-13).

| Need | Model | Notes |
|---|---|---|
| **Org X has room Y every Monday 16–18 this semester** (a standing allocation) | An **admin-created series on behalf of org X**: `kind = BOOKING`, `APPROVED`, `requested_by_id = admin`, audited | Same table and constraint as everything else. It shows in org X's calendar and feeds. Org X can cancel single occurrences to free the room. |
| **Room closed for maintenance, cleaning, VT's own use or exams** | A **block**: `kind = BLOCK`, `organization_id = NULL`, `APPROVED`, single or series | It occupies the room through the same exclusion constraint. Shown as "Stengt: <reason>". Creating a block over existing approved bookings fails with 409 and lists them. The admin cancels them first, with notification, or picks a different time. |
| **Priority window**: org X has first right to room Y on Mondays, but others may book if X doesn't claim it by a deadline | **Postponed.** Would need `room_priority_windows` and rules. | Only build this if Velferdstinget confirms the need (Q-13). |
| **Semester allocation round**: orgs apply for standing slots, and the admin allocates in bulk | **Postponed.** Recurring requests (`PENDING` series) plus admin bulk approval cover a manual version. | |

**Interaction with ordinary bookings.** Because fixed reservations and blocks are approved rows in the same table, they cannot overlap anything approved. They show up in conflict checks, previews and calendars with no special cases. Pending requests overlapping a new block or fixed reservation remain, but cannot be approved, exactly like today's "competing" warning in the admin queue.

---

## 8. Booking restrictions

**Principle:** typed columns with a **two-level fallback** (room override → `system_settings`), plus organization-level quota overrides. No rule DSL.

| Rule | Where configured | Checked when | Default (Q-10) |
|---|---|---|---|
| Max duration | `rooms.max_duration_minutes` ?? settings | create, reschedule | 12 h |
| Max advance window | `rooms.max_advance_days` ?? settings | create, reschedule | 180 days |
| Minimum notice | `rooms.min_notice_minutes` ?? settings | create, reschedule | 0 (not in the past) |
| Opening hours | `room_opening_hours` (none = always) | create, reschedule | none |
| Max pending requests per user / org | settings, `organizations.max_pending_requests` | create (REQUEST) | 10 / 25 |
| Max future bookings per org | `organizations.max_future_bookings` ?? settings | create | 50 |
| Duplicate pending request | unique index | create | always on |
| Recurring limits | `max_series_occurrences`, advance window | series create | 30 |
| Cancellation deadline | `rooms.cancellation_deadline_hours` ?? settings | cancel (non-admin) | 0 (any time before start) |
| No crossing midnight | constant in `BookingRules` (prototype rule) | create, reschedule | on (Q-11) |
| Org-specific rights | `room_access` | always | — |
| Text lengths | column types and DTO validation | always | 80/500/300 |

- **Admins bypass limits.** They do not bypass conflicts or the constraint. Each bypass is noted in the audit log entry.
- **Approval does not re-check quotas.** The admin's decision is the control. It does re-check access and availability (§5).
- **Errors.** All violations are collected and returned together as `RULE_VIOLATION` with a `violations[]` list (`API_DESIGN.md` §5). The form can then show every problem at once.

---

## 9. Time zones

- **Store instants** as `timestamptz`. The server session time zone is UTC.
- **Business time zone `Europe/Oslo`** for opening hours, "no crossing midnight", recurrence expansion, and the day boundaries in reports.
- The API **accepts ISO-8601 with an offset** (`2026-10-14T18:00:00+02:00`) and returns UTC (`...Z`).
- **Reject nonexistent local times** in recurrence (the spring-forward gap). Ambiguous fall-back times resolve to the *earlier* offset, documented.
- **"Now"** comes from an injected `java.time.Clock`, never from the client (RISK-05).

---

## 10. Retention, history and lifecycle

| Data | Retention (default, Q-22) | Mechanism |
|---|---|---|
| Bookings (all statuses) | Kept as history | Status, never deleted |
| Personal details on old bookings | `description` cleared and `requested_by_id` pointed at an anonymized placeholder after **24 months** | Nightly job |
| Users | Active while used. Users with no memberships and no login for 24 months are anonymized. On GDPR request, anonymized immediately. | `status = 'ANONYMIZED'`, email NULL, identities deleted |
| Organizations | Archived, never deleted | `status = 'ARCHIVED'` |
| Rooms | Archived, never deleted | `status = 'ARCHIVED'` |
| Notifications | 12 months | Nightly delete |
| Audit log | 36 months | Nightly delete of older rows (by the owner role, not the app role) |
| Sessions | Spring Session expiry | Built-in cleanup |
| Expired or used invitations | 90 days | Nightly delete |

A booking that references an archived org or room stays valid, because the FKs are `RESTRICT` and nothing is deleted.

---

## 11. Database roles and privileges (C-14)

| Role | Used by | Privileges |
|---|---|---|
| `booking_owner` | Flyway at startup, and retention jobs that delete from `audit_log` | Owns the schema; DDL |
| `booking_app` | The application datasource | `SELECT, INSERT, UPDATE, DELETE` on application tables. **`SELECT, INSERT` only on `audit_log`** (append-only). No DDL. |
| `booking_backup` | The backup container | Read-only (`pg_read_all_data`) |

There are no superuser connections from the application. PostgreSQL is not published outside the Docker `db` network.

---

## 12. Migrations

- **Flyway**, plain SQL, `src/main/resources/db/migration/V{n}__{description}.sql`.
- `V1__core_schema.sql` contains everything in §3.
- **Never edit an applied migration.** Fixes go in a new migration.
- **Expand/contract** for compatibility with app rollbacks:
  1. Add the nullable column or new table, and deploy.
  2. Backfill, and switch the code to use it.
  3. Remove the old column in a later release.
- **Dev and staging seed:** `db/seed/R__dev_seed.sql`, a repeatable migration loaded only in the `dev` and `staging` profiles. It ports the prototype's `mockData.ts`.
- CI runs every migration against an empty PostgreSQL 18 (Testcontainers). Hibernate `validate` checks that entities match.
