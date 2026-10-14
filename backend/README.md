# Booking backend

A minimal REST API for the Velferdstinget Vest room booking system, built with Spring Boot 4.1, Java 21 and PostgreSQL. This is the first slice of the planned design.

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

- The API listens on `http://localhost:8080`.
- Flyway creates the schema on startup.
- The `dev` profile also loads seed data from `src/main/resources/db/dev/`: the prototype's users, organizations, rooms and permissions.
- On every start, the `dev` profile also adds sample bookings for the current and the next week (`dev/DevSampleBookings.java`): confirmed bookings, decided requests and pending requests, including one that conflicts and two that compete for the same slot. Each sample has a fixed id per week and is inserted with `ON CONFLICT DO NOTHING`, so restarts never duplicate them, and existing bookings, cancellations and decisions are never changed. A sample that would overlap an existing confirmed booking is skipped.
- To use a different port, set `DB_PORT` (for Compose) and `DB_URL` (for the app).
- `docker compose down -v` deletes the database.
- Running `docker compose` here creates a separate database (project `backend`) from the one `make` uses (project `vt-booking`). Use one or the other, since both bind port 5432.

### Docker image

`Dockerfile` is a multi-stage build: Maven builds the jar, and the runtime image runs it as a non-root user. The image sets no Spring profile, so the development login and seed data are off. Dev login only starts together with the `dev` profile. If `APP_DEV_AUTH_ENABLED=true` is set without it, startup fails.

## Development login

The `dev` profile enables a **development-only** login. Every seeded user logs in with the password `dev` (override with `DEV_AUTH_PASSWORD`).

| Email | Organization(s) |
|---|---|
| `kari@example.no` | Organisasjon A |
| `ola@example.no` | Organisasjon B |
| `ingrid@example.no` | Organisasjon C |
| `jonas@example.no` | A (organization admin) and C |
| `admin@example.no` | Administrator, no organization |

Without the `dev` profile, login is disabled and every request gets 401. Feide/Google login replaces this later.

Authentication uses a session cookie, with CSRF protection on every state-changing request, including login:

```bash
J=cookies.txt
curl -s -c $J -b $J localhost:8080/api/auth/csrf                      # sets XSRF-TOKEN cookie
TOKEN=$(awk '$6=="XSRF-TOKEN"{print $7}' $J)
curl -s -c $J -b $J -H "X-XSRF-TOKEN: $TOKEN" \
     -d 'email=kari@example.no&password=dev' localhost:8080/api/auth/login   # 204

curl -s -b $J localhost:8080/api/me
```

The CSRF token rotates on login, so call `/api/auth/csrf` again and read a fresh token before the next POST.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/auth/csrf` | Sets the `XSRF-TOKEN` cookie |
| POST | `/api/auth/login` | Form fields `email`, `password`. Returns 204 or 401. |
| POST | `/api/auth/logout` | Returns 204 |
| GET | `/api/me` | Current user and memberships |
| GET | `/api/rooms` | Rooms, each with your effective permission per organization you belong to. Administrators get every active organization's permission. |
| GET | `/api/organizations` | Active organizations: `id` and `name` only |
| GET | `/api/admin/users` | Admin only. Users with their memberships. |
| GET | `/api/bookings?from=…&to=…[&roomId=…]` | Bookings overlapping `[from, to)`, max 62 days. Approved bookings are visible to everyone; pending requests only to your own organization and admins. |
| GET | `/api/bookings/mine` | Your own bookings and requests, in every status, that ended in the last 90 days or later |
| GET | `/api/bookings/requests` | Admin only. Every pending request, plus the 50 most recently decided ones. |
| GET | `/api/bookings/{id}` | One booking. Returns 404 if you may not see it. |
| POST | `/api/bookings` | `{ roomId, organizationId, title, description?, start, end }`. Returns 201 with `APPROVED` (DIRECT) or `PENDING` (REQUEST). |
| POST | `/api/bookings/{id}/approve` | Admin only. `{ version, comment? }` |
| POST | `/api/bookings/{id}/reject` | Admin only. `{ version, reason }` |
| POST | `/api/bookings/{id}/cancel` | Requester (while still a member), the organization's admins (while it is active), or a global admin. `{ version, reason? }`. Only future `APPROVED`/`PENDING` bookings. |
| PUT | `/api/bookings/{id}` | Edit. Same people as cancel. `{ version, roomId, title, description?, start, end }`; the organization can't change. A new room or time is checked like a new booking, and the room permission decides the status (see below). |
| POST | `/api/bookings/series/preview` | Weekly series dry run, same body as below. `{ occurrences: [{ start, end, conflict }] }` |
| POST | `/api/bookings/series` | `{ roomId, organizationId, title, description?, start, end, recurrence: { intervalWeeks (1–4), until (local date, inclusive) }, skipConflicts? }`. 2–52 occurrences. 201 `{ seriesId, created: [booking], skipped: [{ start, end }] }`; a conflict without `skipConflicts` is 409 with `conflicts: [{ start, end }]` and nothing written. |
| GET | `/api/bookings/series/{seriesId}` | The occurrences you may see, by start |
| PUT | `/api/bookings/series/{seriesId}` | Edit an occurrence and the following ones. `{ fromBookingId, version, roomId, title, description?, start, end, skipConflicts?, dryRun? }`. 200 `{ updated: [booking], skipped: [{ id, start, end }] }`; a conflict without `skipConflicts` is 409 with `conflicts: [{ id, start, end }]`. |
| POST | `/api/bookings/series/{seriesId}/cancel` | `{ fromBookingId?, reason? }`. Every future occurrence, or that one and the following. Returns the cancelled ones. |
| POST | `/api/bookings/series/{seriesId}/approve` | Admin only. `{ comment? }`. 200 `{ approved: [booking], notApproved: [{ id, start, end, code, reason }] }` |
| POST | `/api/bookings/series/{seriesId}/reject` | Admin only. `{ reason }`. Returns the rejected ones. |
| GET | `/api/admin/rooms/{id}/future-bookings`, `/api/admin/organizations/{id}/future-bookings`, `/api/admin/users/{id}/future-bookings` | Admin only. Future `APPROVED`/`PENDING` bookings in the room, of the organization, or requested by the user: what a deactivation may cancel. |
| GET | `/api/organizations/{id}/invitations` | Organization admins and global admins. `[{ id, email, role, invitedByName, createdAt }]` |
| DELETE | `/api/organizations/{id}/invitations/{invitationId}` | Withdraw. 204. |
| GET | `/api/me/invitations` | Your invitations to active organizations. `[{ id, organizationId, organizationName, role, invitedByName, createdAt }]` |
| POST | `/api/me/invitations/{id}/accept` | Joins with the invited role. Returns the updated `/api/me`. |
| POST | `/api/me/invitations/{id}/decline` | 204 |

Booking responses include `requestedById`, `requestedByName`, `description`, `decidedByName`, `decisionComment`, `cancelledById`, `cancelledByName`, `cancellationReason` and `updatedByName` only for the booking's own organization and administrators. For everyone else they are `null`. `roomName`, `updatedAt` and `seriesId` are shown to everyone who sees the booking.

**Edits.** A new title or description changes nothing else. A new room or time: `DIRECT` makes the booking `APPROVED`; `REQUEST` makes it `PENDING` again and clears the old decision (the slot is free until approved), except when a global admin moves an approved booking. Bookings left in an archived room can only get a new title or description, or be cancelled. A move that would turn a booking into a request is refused (`INVALID_STATE`) when the person who booked is no longer a member or is disabled, since such a request could never be approved; cancel and book again instead. A global admin moving a direct booking into a room that needs approval keeps it approved without recording a decision.

**Series** occurrences keep their local wall-clock time across daylight saving changes (`booking.time-zone`, default `Europe/Oslo`). Every occurrence is an ordinary booking: it can be edited, cancelled, approved or rejected on its own and keeps its `seriesId`. When following occurrences are edited, the anchor's start shift is applied in local time and its new length as an absolute duration. Series approve, reject and cancel take no `version`, unlike the single-booking calls.

**Deactivation.** Disabling or archiving a room (`PUT /api/admin/rooms/{id}`) or archiving an organization (`PATCH /api/admin/organizations/{id}`) cancels the future bookings only with `cancelFutureBookings: true`. Archiving an organization deletes its pending invitations and makes it read-only for its organization admins. Disabling a user cancels their future pending requests, and their approved bookings too with `cancelFutureBookings: true`. Removing a membership cancels the user's future pending requests for that organization. Approval is refused when the requester's account is disabled.

**Adding members.** An organization admin adding a new email creates the account (temporary password, must be changed at first login) and the membership. For an existing account they only create an invitation, and the response is the same whatever the account is: `{ result: "INVITED", member: null, temporaryPassword: null }`. A global admin adds existing accounts directly.

`version` comes from the booking response. If the booking has changed since you read it, you get 409 `VERSION_CONFLICT`.

Errors are RFC 9457 Problem Details with a stable `code` (and, for series conflicts, a `conflicts` list): `VALIDATION` (400), `NOT_MEMBER` / `NO_PERMISSION` (403), `NOT_FOUND` (404), `CONFLICT`, `INVALID_STATE` or `VERSION_CONFLICT` (409), or `RULE_VIOLATION` (422).

## How the rules are enforced

- **Identity** comes from the server session only. Request bodies have no user, requester or status field, and unknown fields are ignored.
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
- **Pending requests** don't reserve a slot. Several may overlap, matching the prototype. Approving one makes the overlapping ones unapprovable.

## Tests

```bash
./mvnw test
```

The integration tests start PostgreSQL 18 with Testcontainers, so Docker must be running. They cover:

- the login and CSRF flow
- permission and membership checks
- validation
- visibility of pending requests
- client-supplied identity being ignored
- the database constraint on its own
- approval, rejection and cancellation rights, and re-checks on approval
- invalid status changes and stale versions
- 16 parallel bookings for the same slot leaving exactly one approved
- 16 parallel approvals of overlapping requests, and of the same request, each leaving exactly one approved

## Not implemented yet

These are planned:

- Feide/Google login
- notifications
- audit log
- persistent sessions (Spring Session JDBC)
- separate database roles for migrations and the app
- production Docker setup
