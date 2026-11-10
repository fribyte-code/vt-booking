# Architecture

How the room booking system works today. The product requirements are in `../README.md` (Norwegian), the API reference in `../backend/README.md`, and the frontend details in `../frontend/README.md`. Older design documents are in `archive/` and are out of date.

## 1. Overview

```text
Browser ──HTTPS──> Nginx ──/api/──> Spring Boot API ──> PostgreSQL
                     └── static files (React SPA, built with Vite)
```

- The frontend is a client-side rendered React SPA. Nginx serves the static build and proxies `/api/` to the backend, so the browser sees one origin. The session and `XSRF-TOKEN` cookies are first-party, and no CORS is needed. In development, the Vite dev server proxies `/api` the same way.
- The backend is a Spring Boot REST API (Java 21, Spring Security, JPA, Flyway). **It enforces every authorization and booking rule.** Frontend checks only give live feedback.
- PostgreSQL holds all data. Only the backend connects to it.
- No external services are needed at runtime: no email, no identity provider, no cloud APIs.

## 2. Backend structure

| Package | Contents |
|---|---|
| `booking` | `BookingService` (single bookings: create, edit, approve, reject, cancel, lists, bulk cancellation on deactivation), `BookingSeriesService` (weekly series), `BookingController`, the `Booking` entity and DTOs |
| `admin` | System administrator API: users, organizations, memberships, rooms and room access (`AdminService`, `/api/admin/**`) |
| `organization` | Members managed by organization admins (`OrgMemberService`), in-app invitations (`InvitationService`), the organization directory |
| `room` | Room list and `RoomService.effectivePermission`, the one place that decides an organization's booking right for a room |
| `user` | `/api/me`, own password change, `AccountService` (account creation, temporary passwords, email and name rules) |
| `security` | `SecurityConfig`, `CurrentUser`, `LoginThrottle`, `PasswordPolicy`, `TemporaryPasswords`, Argon2id encoder |
| `bootstrap` | The `bootstrap-admin` command line that creates the first SYSTEM_ADMIN |
| `common` | `ApiException` and `ErrorCode`, the Problem Details exception handler, the server clock and booking time zone |

Conventions:

- Every controller method except the CSRF-token endpoint calls `currentUser.require()` (or `requireAllowingPasswordChange()` for `/api/me` and the password change). Login and logout are Spring Security filters. Authorization is done in the services.
- Errors are RFC 9457 Problem Details with a stable `code` and a Norwegian `detail` that is safe to show to users.
- **Persistence.** Bookings are JPA entities with optimistic versioning and row locks. Users, organizations, memberships, rooms and room access are written with `JdbcTemplate` by the admin, member and invitation services. JPA only reads them (and sets `users.last_login_at` with one JPQL update). Only `RoomAccess` is marked `@Immutable`: organizations, memberships and rooms are row-locked through JPA by booking writes, and Hibernate refuses locks on read-only entities; `User` has the JPQL update. `Timestamp` or `OffsetDateTime` is bound in `JdbcTemplate` calls, never `Instant`.
- The server clock is the only source of "now". Weekly series use the `booking.time-zone` setting (default `Europe/Oslo`).

## 3. Authentication and accounts

- **Login:** email and password, form login at `POST /api/auth/login`, with a server-side session cookie (HttpOnly, SameSite=Lax, Secure outside the `dev` profile). The session ID changes at login. Logout is `POST /api/auth/logout`.
- **CSRF:** `csrf.spa()`. The server sets an `XSRF-TOKEN` cookie (with the same `Secure` flag as the session cookie, also when the API only sees plain HTTP behind the reverse proxy), and the SPA echoes it in `X-XSRF-TOKEN` on every state-changing request, including login.
- **Session principal:** the user's ID, never the email. `CurrentUser` reloads the user from the database on every request, so a role change or a disabled account takes effect on the next request.
- **Password changes end other sessions.** Sessions that logged in before `users.password_changed_at` are rejected. Changing your own password keeps the current session; an administrator's reset ends all of them.
- **Forced password change:** accounts created or reset by an administrator get a server-generated temporary password (shown once) and `must_change_password`. Until it is changed, every endpoint except `/api/me` and `/api/me/password` answers `PASSWORD_CHANGE_REQUIRED`.
- **Passwords:** Argon2id through `DelegatingPasswordEncoder`, 8–128 characters counted as code points, no composition rules or blocklist.
- **Brute force:** `LoginThrottle` answers 429 after 5 failed logins per email or 100 per IP address within 15 minutes. Every failed login gets the same bodiless 401. Only wrong credentials count: a login the server can't check (database down, or all 8 password-check slots busy for 2 s) gets 503. Nginx also limits `/api/auth/login` to 60 requests a minute per address (burst 20).
- **Client address:** Nginx decides it and sends it as a single `X-Forwarded-For` value, dropping anything the client sent. It is the TCP peer, or, only for requests from the reverse proxy named in `TRUSTED_PROXY` (`compose.prod.yaml`, via `frontend/real-ip.conf.template`), the address in that proxy's header. Tomcat accepts the header only from private-network peers, so the API port must never be published. `ProxyClientAddressIntegrationTest` runs the real Nginx config in front of the API.
- **Session lifetime:** 8 hours idle. Sessions and the throttle are kept in memory, so the API runs as a single instance and a restart logs everyone out.
- **First administrator:** `java -jar app.jar bootstrap-admin` (or `make bootstrap-admin`). It prompts in the terminal, starts without a web server, and refuses once any SYSTEM_ADMIN exists. There is no HTTP endpoint for it, no development login and no seed data, apart from the shared organization "Eksterne" for public requests (migration V7).
- **Everyone else** is created by an administrator: a SYSTEM_ADMIN (`POST /api/admin/users`), or an ORG_ADMIN adding a new email to their organization. Adding an existing account as an ORG_ADMIN creates an in-app invitation that the user accepts or declines.

## 4. Roles and authorization

Roles: global `USER` or `SYSTEM_ADMIN` on `users`; `MEMBER` or `ORG_ADMIN` per organization on `memberships`.

| Action | Who |
|---|---|
| Book or request on behalf of an organization | Members of that organization, by the organization's permission for the room |
| Edit or cancel a booking that has not started | The requester while still a member, an ORG_ADMIN of the booking's active organization, or a SYSTEM_ADMIN |
| Approve or reject requests | SYSTEM_ADMINs, and for a room with `managing_organization_id` the ORG_ADMINs of that active organization (room managers). `Viewer.mayDecide` in the backend; the queue query selects only their rooms |
| Manage users, organizations, rooms, room access, opening hours and room managers | SYSTEM_ADMIN only (`/api/admin/**`) |
| Manage members of an organization | Its ORG_ADMINs while it is active, and SYSTEM_ADMINs (`/api/organizations/{id}/members`) |

Organization admins can add members (a new email creates an account; an existing one gets an invitation), change roles and remove members. They cannot reset passwords, change anyone's email, status or global role, touch a SYSTEM_ADMIN's membership, or remove or demote the organization's last ORG_ADMIN.

**Visibility.** Every logged-in user sees approved bookings: time, room, title and organization name. Pending requests, descriptions, the people involved, comments and cancellation reasons are only shown to the booking's own organization, the room's managers and SYSTEM_ADMINs. Bookings someone may not see are reported as not found.

## 5. Booking rules

- **Permission** per (organization, room): `DIRECT` books at once (`APPROVED`), `REQUEST` creates a request (`PENDING`), `NONE` cannot book. It is the `room_access` override if present, otherwise the room's `default_permission`. Disabled or archived rooms and archived organizations always give `NONE`.
- **Limits:** no bookings in the past, at most 12 hours per booking, at most 180 days ahead, and no room can be used between 05:00 and 07:00 local time (ending at 05:00 or starting at 07:00 is fine; applies to everyone, admins and public requests included). Title up to 80 characters, description up to 500.
- **Opening hours** per room (optional, one interval per weekday, local time): a booking must lie within the interval of the day it starts on, so at most until 24:00; days without an interval are closed. They apply to everyone and are re-checked on approval; changing them keeps existing bookings.
- **Pending requests do not reserve the slot.** Several may overlap; only one can be approved. A request for a slot that is already approved is refused.
- **Approval re-checks everything:** the requester's membership and account status, the organization's permission for the room, the start time and availability.
- **Expired requests:** a `PENDING` request whose start has passed is expired. This is derived, not stored. It leaves the calendar and the admin queue and is shown as "Utløpt" in Mine bookinger.
- **Edits** (`PUT /api/bookings/{id}`): a new title or description changes nothing else. A new room or time is checked like a new booking: `DIRECT` makes it `APPROVED`; `REQUEST` makes it `PENDING` again with the old decision cleared, except when a SYSTEM_ADMIN moves an approved booking. Bookings in an archived room can only get a new title or description, or be cancelled.
- **Weekly series** (`bookings.series_id`): every 1–4 weeks, 2–52 occurrences, keeping the local wall-clock time across daylight saving changes. Each occurrence is an ordinary booking that can be edited, cancelled, approved or rejected on its own. "This and following" edits shift the later occurrences by the same local offset and give them the anchor's new duration. Taken times fail the operation, or are skipped and reported when the client asks for that.
- **Deactivation never cancels approved bookings silently.** Closing or archiving a room, archiving an organization or disabling a user cancels future bookings only with `cancelFutureBookings: true`, which the admin chooses after seeing `GET /api/admin/{rooms|organizations|users}/{id}/future-bookings`. Disabling a user or removing a membership always withdraws that user's future pending requests.

## 6. Concurrency and integrity

- **Double booking** is prevented by the exclusion constraint `bookings_no_overlap`: no two `APPROVED` bookings in the same room may overlap (half-open ranges, so back-to-back bookings are allowed). It holds under concurrent transactions; the service's pre-check only gives a friendly error.
- **Room lock.** Booking writes for a room lock its row first (`RoomRepository.findByIdForBooking`), so the pre-check is reliable and overlapping inserts can't deadlock on the constraint.
- **Lock order.** Every write takes locks in one order: the requester's membership and the organization (shared), then rooms by ID, then bookings by ID. Removing a membership or archiving an organization therefore waits for a booking in progress, and sees it.
- **Optimistic versioning.** Single-booking edits, approvals, rejections and cancellations send the `version` they read; a stale one is 409 `VERSION_CONFLICT`. A deadlock or serialization failure that still happens is also answered with `VERSION_CONFLICT`, and the client can retry.

## 7. Data model

Tables: `users`, `organizations`, `memberships`, `membership_invitations`, `rooms`, `room_access`, `room_opening_hours`, `bookings`, `public_requests` (requests for Studentvillaen's common areas from the public form `/soknad`, naming one of the rooms marked `rooms.public_requestable` or none, handled by a SYSTEM_ADMIN in Administrasjon → Forespørsler; a linked booking is the truth for time and room, edits of the request update it, and a trigger (V11) releases the request when the booking is cancelled or deleted), `public_request_contacts` (1–10 responsible persons per request). Migrations are in `backend/src/main/resources/db/migration` (Flyway; applied migrations are never edited). There is no audit log or session table.

Integrity in the schema:

- Enum-like columns use CHECK constraints (statuses, roles, permissions).
- Case-insensitive unique email, organization name and room name.
- `bookings`: `end_at > start_at`, a non-blank title, the exclusion constraint above, and CHECK constraints that tie the status to its decision or cancellation fields.
- Users, rooms and organizations are deactivated, never deleted.

## 8. Frontend

- **One data source.** The UI only uses the `DataSource` interface, implemented by `apiDataSource.ts` over the backend API.
- **Business rules** for live feedback are pure functions in `bookingRules.ts`. The server's answer is what counts.
- **Loading.** `AppProvider` loads the signed-in user, rooms, organizations, the calendar's visible range (at most 62 days), the user's own bookings, invitations, and for SYSTEM_ADMINs the request queue. It loads again when the calendar moves outside the loaded range and after every change. Names of other people come with the bookings. The management pages (users, organizations, rooms, members) load their own data through `adminApi.ts`.
- **Notifications** about decisions and cancellations are derived from the loaded bookings. "Merk alle som lest" is remembered per browser in localStorage.

## 9. Tests

- **Backend:** integration tests against PostgreSQL in Testcontainers (`./mvnw test`, needs Docker). `test-fixtures.sql` replaces all data before every test. They cover login, CSRF and sessions, authorization per role, every booking rule, series, deactivation, invitations, bootstrap, and concurrency (parallel bookings and approvals leave exactly one approved).
- **Frontend:** Vitest tests for the rules, both data sources and the API client (`npm test`).
- **End to end:** `make e2e` runs the booking workflow through the real API against a running local app, logged in as an existing SYSTEM_ADMIN (`E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`). It creates its organizations, rooms and users through the admin API, and disables and archives them afterwards; it never connects to the database. It refuses a non-loopback base URL, and an API whose session cookie is `Secure` (anything but the `dev` profile).

## 10. Deployment

Locally, `make up` runs PostgreSQL, the API (with the `dev` profile) and Nginx in Docker on `http://localhost:8088`; it is not a production setup. Production uses `compose.prod.yaml` and the `make prod-*` commands behind the host's HTTPS reverse proxy; see `DEPLOYMENT.md`.
