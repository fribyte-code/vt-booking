# Booking backend

The REST API of the Velferdstinget Vest room booking system: Spring Boot 4.1, Java 21, Spring Security, JPA, Flyway and PostgreSQL. It enforces every authorization and booking rule. See `../docs/ARCHITECTURE.md` for how it fits together.

The React frontend in `../frontend/` uses this API in its `api` mode (`npm run dev:api`, see its README).

## Requirements

- Java 21
- Docker (for the local database and the integration tests)

Maven is included as `./mvnw`.

## Run locally

From the repository root, `make dev` starts the database, this API and the frontend together, and `make up` runs everything in Docker. See the root `README.md`. To run the API on its own:

```bash
docker compose up -d --wait                 # PostgreSQL 18 on 127.0.0.1:5432
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
```

- The API listens on `http://localhost:8080`. Flyway creates the schema on startup.
- The `dev` profile only sets the local database password and allows session cookies over plain `http://localhost`. It adds no users or data.
- The database starts empty. Create the first administrator (below), then everything else through the app or the admin API.
- To use a different port, set `DB_PORT` (for Compose) and `DB_URL` (for the app).
- `docker compose down -v` deletes the database.
- Running `docker compose` here creates a separate database (project `backend`) from the one `make` uses (project `vt-booking`). Use one or the other, since both bind port 5432.

### Configuration

| Variable | Default | |
|---|---|---|
| `DB_URL` | `jdbc:postgresql://localhost:5432/booking` | |
| `DB_USER` | `booking` | |
| `DB_PASSWORD` | empty (`booking-dev` with the `dev` profile) | Must be set outside development |
| `SPRING_PROFILES_ACTIVE` | none | `dev` for local development only |

`booking.time-zone` (default `Europe/Oslo`) is the local time zone for weekly series.

### Docker image

`Dockerfile` is a multi-stage build: Maven builds the jar, and the runtime image runs it as a non-root user. The image sets no Spring profile. Production runs it with `../compose.prod.yaml`; see `../docs/DEPLOYMENT.md`.

## First administrator and logging in

There is no development login and no seed data. Create the first SYSTEM_ADMIN once, from a terminal:

```bash
make bootstrap-admin                                   # from the repository root, in Docker
SPRING_PROFILES_ACTIVE=dev java -jar target/booking-backend-*.jar bootstrap-admin  # or with a built jar
```

It asks for email, name and password (8–128 characters), starts without a web server, and refuses if any SYSTEM_ADMIN already exists. Other users are created by an administrator in the app, and get a temporary password that they must change at first login.

Authentication uses a session cookie, with CSRF protection on every state-changing request, including login:

```bash
J=cookies.txt
curl -s -c $J -b $J localhost:8080/api/auth/csrf                      # sets XSRF-TOKEN cookie
TOKEN=$(awk '$6=="XSRF-TOKEN"{print $7}' $J)
curl -s -c $J -b $J -H "X-XSRF-TOKEN: $TOKEN" \
     --data-urlencode 'email=you@example.no' --data-urlencode 'password=...' \
     localhost:8080/api/auth/login                                     # 204, or 401 / 429

curl -s -b $J localhost:8080/api/me
```

The CSRF token rotates on login, so call `/api/auth/csrf` again and read a fresh token before the next POST.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/auth/csrf` | Sets the `XSRF-TOKEN` cookie |
| POST | `/api/auth/login` | Form fields `email`, `password`. Returns 204, 401 for any failure, or 429 after too many failures. |
| POST | `/api/auth/logout` | Returns 204 |
| GET | `/api/me` | Current user, memberships and `mustChangePassword`. Also works while a password change is required. |
| POST | `/api/me/password` | `{ currentPassword, newPassword }`. 204. Ends your other sessions; this one stays logged in. |
| GET | `/api/rooms` | Rooms, each with your effective permission per organization you belong to. Administrators get every active organization's permission. |
| GET | `/api/organizations` | Active organizations: `id` and `name` only |
| GET | `/api/bookings?from=…&to=…[&roomId=…]` | Bookings overlapping `[from, to)`, max 62 days. Approved bookings are visible to everyone; pending requests only to your own organization and admins. |
| GET | `/api/bookings/mine` | Your own bookings and requests, in every status, that ended in the last 90 days or later |
| GET | `/api/bookings/requests` | Admin only. Pending requests that have not started, plus the 50 most recently decided ones. |
| GET | `/api/bookings/{id}` | One booking. Returns 404 if you may not see it. |
| GET | `/api/bookings/{id}/calendar.ics` | An approved booking as an iCalendar file (`text/calendar`, inline), for "Legg til i kalender" (Apple Calendar has no add-event link). 404 if you may not see it, 409 if not approved. |
| POST | `/api/bookings` | `{ roomId, organizationId, title, description?, start, end }`. Returns 201 with `APPROVED` (DIRECT) or `PENDING` (REQUEST). |
| POST | `/api/bookings/{id}/approve` | Admin only. `{ version, comment? }` |
| POST | `/api/bookings/{id}/reject` | Admin only. `{ version, reason }` |
| POST | `/api/bookings/{id}/cancel` | Requester (while still a member), the organization's admins (while it is active), or a global admin. `{ version, reason? }`. Only future `APPROVED`/`PENDING` bookings. |
| PUT | `/api/bookings/{id}` | Edit. Same people as cancel. `{ version, roomId, title, description?, start, end }`; the organization can't change. A new room or time is checked like a new booking, and the room permission decides the status (see below). |
| POST | `/api/bookings/series/preview` | Weekly series dry run, same body as below. `{ occurrences: [{ start, end, conflict }] }` |
| POST | `/api/bookings/series` | `{ roomId, organizationId, title, description?, start, end, recurrence: { intervalWeeks (1–4), until (local date, inclusive) }, skipConflicts? }`. 2–52 occurrences. 201 `{ seriesId, created: [booking], skipped: [{ start, end }] }`; a conflict without `skipConflicts` is 409 with `conflicts: [{ start, end }]` and nothing written. |
| GET | `/api/bookings/series/{seriesId}` | The occurrences you may see, by start |
| GET | `/api/bookings/series/{seriesId}/calendar.ics` | The series' approved occurrences that have not ended, one event each. 409 if there are none. |
| PUT | `/api/bookings/series/{seriesId}` | Edit an occurrence and the following ones. `{ fromBookingId, version, roomId, title, description?, start, end, skipConflicts?, dryRun? }`. 200 `{ updated: [booking], skipped: [{ id, start, end }] }`; a conflict without `skipConflicts` is 409 with `conflicts: [{ id, start, end }]`. |
| POST | `/api/bookings/series/{seriesId}/cancel` | `{ fromBookingId?, reason? }`. Every future occurrence, or that one and the following. Returns the cancelled ones. |
| POST | `/api/bookings/series/{seriesId}/approve` | Admin only. `{ comment? }`. 200 `{ approved: [booking], notApproved: [{ id, start, end, code, reason }] }` |
| POST | `/api/bookings/series/{seriesId}/reject` | Admin only. `{ reason }`. Returns the rejected ones. |
| GET | `/api/admin/rooms/{id}/future-bookings`, `/api/admin/organizations/{id}/future-bookings`, `/api/admin/users/{id}/future-bookings` | Admin only. Future `APPROVED`/`PENDING` bookings in the room, of the organization, or requested by the user: what a deactivation may cancel. |
| GET | `/api/admin/users` | Users with status, last login and memberships |
| POST | `/api/admin/users` | `{ email, displayName, globalRole, memberships?: [{ organizationId, role }] }`. 201 `{ user, temporaryPassword }`; the password is shown only here. |
| PATCH | `/api/admin/users/{id}` | Any of `{ email, displayName, globalRole, status, cancelFutureBookings }`. You can't demote or disable yourself, and one active SYSTEM_ADMIN must remain. |
| POST | `/api/admin/users/{id}/reset-password` | New temporary password, shown once. Ends the user's sessions. |
| PUT, DELETE | `/api/admin/users/{id}/memberships/{organizationId}` | Add or change (`{ role }`), or remove a membership |
| GET, POST | `/api/admin/organizations` | List (with member counts), or create `{ name }` |
| PATCH | `/api/admin/organizations/{id}` | Any of `{ name, status, cancelFutureBookings }` |
| GET, POST | `/api/admin/rooms` | List (with access overrides), or create `{ name, description?, location?, capacity?, color, defaultPermission }` |
| PUT | `/api/admin/rooms/{id}` | The same fields, plus `status` and `cancelFutureBookings` |
| DELETE | `/api/admin/rooms/{id}` | Deletes the room with its access overrides. A room with bookings must be `ARCHIVED` first (409 `CONFLICT` otherwise); its bookings, past ones included, are then deleted with it |
| PUT | `/api/admin/rooms/{id}/access/{organizationId}` | `{ permission }` sets the organization's override; `{ permission: null }` removes it |
| GET | `/api/organizations/{id}/members` | Organization admins (active organization) and SYSTEM_ADMINs. `[{ userId, displayName, email, role, status }]` |
| POST | `/api/organizations/{id}/members` | `{ email, displayName?, role }`. 201 `{ result, member, temporaryPassword }`, see "Adding members" below. |
| PUT, DELETE | `/api/organizations/{id}/members/{userId}` | Change the role (`{ role }`), or remove the member |
| GET | `/api/organizations/{id}/invitations` | Organization admins and global admins. `[{ id, email, role, invitedByName, createdAt }]` |
| DELETE | `/api/organizations/{id}/invitations/{invitationId}` | Withdraw. 204. |
| GET | `/api/me/invitations` | Your invitations to active organizations. `[{ id, organizationId, organizationName, role, invitedByName, createdAt }]` |
| POST | `/api/me/invitations/{id}/accept` | Joins with the invited role. Returns the updated `/api/me`. |
| POST | `/api/me/invitations/{id}/decline` | 204 |

Booking responses include `requestedById`, `requestedByName`, `description`, `decidedByName`, `decisionComment`, `cancelledById`, `cancelledByName`, `cancellationReason` and `updatedByName` only for the booking's own organization and administrators. For everyone else they are `null`. `roomName`, `updatedAt` and `seriesId` are shown to everyone who sees the booking.

**Edits.** A new title or description changes nothing else. A new room or time: `DIRECT` makes the booking `APPROVED`; `REQUEST` makes it `PENDING` again and clears the old decision (the slot is free until approved), except when a global admin moves an approved booking. Bookings left in an archived room can only get a new title or description, or be cancelled. A move that would turn a booking into a request is refused (`INVALID_STATE`) when the person who booked is no longer a member or is disabled, since such a request could never be approved; cancel and book again instead. A global admin moving a direct booking into a room that needs approval keeps it approved without recording a decision.

**Series** occurrences keep their local wall-clock time across daylight saving changes (`booking.time-zone`, default `Europe/Oslo`). Every occurrence is an ordinary booking: it can be edited, cancelled, approved or rejected on its own and keeps its `seriesId`. When following occurrences are edited, the anchor's start shift is applied in local time and its new length as an absolute duration. Series approve, reject and cancel take no `version`, unlike the single-booking calls.

**Deactivation.** Disabling or archiving a room (`PUT /api/admin/rooms/{id}`) or archiving an organization (`PATCH /api/admin/organizations/{id}`) cancels the future bookings only with `cancelFutureBookings: true`. Archiving an organization deletes its pending invitations and makes it read-only for its organization admins. Disabling a user cancels their future pending requests, and their approved bookings too with `cancelFutureBookings: true`. Removing a membership cancels the user's future pending requests for that organization. Approval is refused when the requester's account is disabled.

**Adding members.** An organization admin adding a new email creates the account (temporary password, must be changed at first login) and the membership. For an existing account they only create an invitation, and the response is the same whatever that account's status or role: `{ result: "INVITED", member: null, temporaryPassword: null }`. (Whether an account existed at all can be told from `ADDED` versus `INVITED`.) A SYSTEM_ADMIN adds existing accounts directly. Organization admins can't touch a SYSTEM_ADMIN's membership or remove or demote the last ORG_ADMIN.

`version` comes from the booking response. If the booking has changed since you read it, you get 409 `VERSION_CONFLICT`.

Errors are RFC 9457 Problem Details with a stable `code` (and, for series conflicts, a `conflicts` list): `VALIDATION` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` / `NOT_MEMBER` / `NO_PERMISSION` / `PASSWORD_CHANGE_REQUIRED` (403), `NOT_FOUND` (404), `CONFLICT`, `INVALID_STATE` or `VERSION_CONFLICT` (409), or `RULE_VIOLATION` (422).

## How the rules are enforced

- **Identity** comes from the server session only: the session holds the user ID, and `CurrentUser` reloads the user, role and status on every request. Request bodies have no user, requester or status field, and unknown fields are ignored.
- **Membership and room permission** are read from the database on every booking (`BookingService`). Effective permission is the per-organization override in `room_access`, or else the room's `default_permission`. It is computed in `RoomService.effectivePermission`.
- **Limits:**
  - No bookings in the past.
  - Max 12 hours per booking.
  - Max 180 days ahead.
  - Title up to 80 characters, description up to 500.
- **Double booking** is prevented by the PostgreSQL exclusion constraint `bookings_no_overlap` on approved bookings. It holds under concurrent requests. The service's pre-check only provides the friendly error message.
- **Writes for the same room are serialized** with a row lock on the room (`RoomRepository.findByIdForBooking`). Without it, concurrent overlapping inserts can deadlock on the exclusion constraint.
- **Lock order.** Writes take their locks in one order: the requester's membership and the organization (shared, for creates and moves), then rooms (by id), then the bookings themselves (by id, for writes that change several). If PostgreSQL still reports a deadlock or serialization failure, the API answers 409 `VERSION_CONFLICT` and the client can retry.
- **Approval re-checks everything**, because access may have changed since the request was made: the requester's membership, the organization's permission for the room, the start time, and availability.
- **Who decided and who cancelled** is stored on the booking (`decided_by_id`, `cancelled_by_id`, with timestamps and comments).
- **Status changes** use optimistic locking (`version`), so two people acting on the same booking can't both succeed.
- **Pending requests** don't reserve a slot. Several may overlap. Approving one makes the overlapping ones unapprovable.

## Tests

```bash
./mvnw test
```

Most tests are integration tests that start PostgreSQL 18 with Testcontainers, so Docker must be running. `src/test/resources/test-fixtures.sql` replaces all data before every test. After deleting test classes, run `./mvnw clean test`, or stale classes in `target/` still run. A single class: `./mvnw -q test -Dtest=ClassName`.

They cover:

- login, CSRF, sessions, the login throttle and the forced password change
- account management by system and organization admins, invitations, and the bootstrap command
- membership, permission and validation checks, and client-supplied identity being ignored
- visibility of pending requests and of other organizations' details
- approval, rejection, cancellation and edit rights, and re-checks on approval
- weekly series: creation, conflicts, approval and "this and following" edits; keeping the local time across daylight saving changes is covered by the unit tests in `SeriesOccurrencesTest`
- deactivation of rooms, organizations, users and memberships
- the database constraint on its own, and parallel bookings and approvals leaving exactly one approved

## Not implemented yet

- audit log
- email notifications
- persistent sessions (sessions and the login throttle are in memory, so run one instance)
- separate database roles for migrations and the app
