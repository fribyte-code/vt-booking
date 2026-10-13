# Architecture

Production architecture for the Velferdstinget Vest room booking system.

**Status:** proposal for review (2026-10-13). Nothing in this document is implemented yet.

**Related documents**

| Document | Contents |
|---|---|
| [`../README.md`](../README.md) | Product spec (Norwegian): functional requirements and MVP |
| [`../SECURITY_AUDIT.md`](../SECURITY_AUDIT.md) | Audit findings (VULN-xx, RISK-xx, C-xx) referenced throughout |
| [`../velferdstinget-booking/README.md`](../velferdstinget-booking/README.md) | Prototype behaviour, demo users and assumptions |
| [`DATABASE_DESIGN.md`](DATABASE_DESIGN.md) | Schema, constraints and conflict strategy |
| [`API_DESIGN.md`](API_DESIGN.md) | REST endpoints, authorization and error format |
| [`DEVELOPMENT_PLAN.md`](DEVELOPMENT_PLAN.md) | Phases, testing strategy and CI |
| [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md) | Decisions needed from Velferdstinget, with proposed defaults |

**Labels used in these documents**

- **REQ**: a requirement from the README or the project brief.
- **REC**: our recommendation.
- **ASM**: an assumption we are making until Velferdstinget confirms or corrects it (see `OPEN_QUESTIONS.md`).

---

## 1. Starting point: what the prototype gives us

We inspected the prototype in `velferdstinget-booking/` before writing this plan.

### What carries over to production

| Asset | Where | How it is reused |
|---|---|---|
| Domain model and statuses | `src/types/index.ts` | Becomes the API DTO shape. The fields map almost 1:1 to the `bookings` table. |
| Booking rules | `src/services/bookingRules.ts` | This is the reference implementation for the backend `BookingRules`. Its behaviour includes half-open intervals, "only APPROVED blocks", rejecting a request for an already-confirmed slot, and no bookings in the past. |
| Rule tests | `src/services/bookingService.test.ts` | These six scenarios, plus the nine audit PoCs (SECURITY_AUDIT Appendix A), become the first backend test cases. |
| Service seam | `src/services/bookingService.ts` | Callers already treat it as an async API with error codes (`BookingError.code`), so we can replace it with `fetch` without rewriting components. |
| UI | `components/`, `pages/` | The booking dialog with live feedback, details dialog, My Bookings tabs, admin queue with conflict/competition warnings, notification bell, room filter and the UI kit. All of these stay. |
| Calendar | `components/calendar/BookingCalendar.tsx` | FullCalendar 6 setup, Norwegian locale, pending styling (`ev-pending`). Drag/resize is added on top of it. |

### What must be replaced before production

This is not a style preference. Each item is a production blocker.

| Prototype mechanism | Why it is unsafe | Replacement | Audit ref |
|---|---|---|---|
| `UserSwitcher` and `vt-booking:current-user` in localStorage | Anyone can become admin | OIDC login with a server-side session | VULN-01, C-1, C-2 |
| All data and rules in localStorage | DevTools can edit roles, permissions and statuses | PostgreSQL as the single source of truth, and every rule enforced in the backend | VULN-02, C-4 |
| `getData()` loads every user, booking, room and org | Leaks emails and other orgs' details; doesn't scale | Role-scoped, range-limited and paginated endpoints | RISK-03 |
| `actorId` parameter on every mutation | Impersonation if it is ported literally into the API | Actor taken from the session only | RISK-02 |
| `findConflicts` then `push` | Check-then-insert race | PostgreSQL exclusion constraint | RISK-01 |
| No limits on duration, horizon, quantity or text length | Room hoarding, queue flooding, storage abuse | Server-side limits, DB `CHECK`s, body size caps | VULN-03, -05, -06 |
| Approve checks only admin role and conflicts | Revoked access still gets approved | Approval re-validates membership and permission in the same transaction | VULN-04 |
| Cancel checks only `requestedById` | Ex-members can cancel the org's bookings | Requires current membership or the admin role | VULN-07 |
| Client clock (`new Date()`) and browser time zone | Time rules can be bypassed; DST bugs | Server `Clock`, `timestamptz`, business time zone `Europe/Oslo` | RISK-05 |
| `decisionSeen` flag on the booking | Notification state is mixed into booking data | `notifications` table | — |
| Mock data, "Tilbakestill demodata", demo banner | Not production behaviour | Removed. Seeds move to a dev-only migration. | C-20 |

### What the prototype does not do yet

We checked the code for each of these:

- No drag, drop or resize (`editable` is not set on FullCalendar).
- No recurring bookings, fixed reservations or room blocks.
- No room, organization or permission editing (the admin "Rom og tilganger" tab is read-only).
- No ICS, email or audit log.
- No booking limits.

---

## 2. System overview

```text
                 Internet (HTTPS)
                        │
             ┌──────────▼──────────┐
             │  web  (Nginx)       │  TLS, security headers, rate limits
             │  • /         SPA    │  static files from the Vite build
             │  • /api/     ─────┐ │
             │  • /oauth2/, /login/oauth2/ ─┤  OIDC redirects
             │  • /ical/    ─────┤ │  token-protected feeds
             └──────────────────┼─┘
                  network: app  │ (internal)
             ┌──────────────────▼─┐        ┌──────────────────────┐
             │  api (Spring Boot) │──SMTP─▶│ Mail relay (VT/host) │
             │  REST + OIDC client│        └──────────────────────┘
             │  session, rules,   │──OIDC─▶ Feide, Google (login only)
             │  jobs (mail, expiry)│
             └─────────┬──────────┘
                  network: db (internal: true)
             ┌─────────▼──────────┐   ┌───────────────────────────┐
             │ db (PostgreSQL 18) │◀──│ backup (pg_dump + restic) │──▶ offsite
             └────────────────────┘   └───────────────────────────┘
```

**One API service and no microservices (REC).** The domain is small: about 10 tables and one bounded context. Splitting it would only add network failure modes and deployment work.

### Component responsibilities

| Component | Responsibilities | Explicitly not its job |
|---|---|---|
| **SPA** (React, Vite, FullCalendar) | Rendering and interaction. UX-only prechecks, such as disabling a button or showing "the room looks busy". Caching server state. | Authorization decisions, choosing identity, trusting its own clock |
| **Nginx (`web`)** | TLS termination, serving `dist/`, reverse proxy to `api`, security headers (C-9), coarse rate limits (C-8), body size limits | Business logic |
| **API** (Spring Boot) | Authentication (OIDC client), sessions, CSRF, authorization, all booking rules, transactions, audit log, notifications/email outbox, ICS feeds, scheduled jobs | Serving the SPA |
| **PostgreSQL** | Source of truth. Last-line integrity: exclusion constraint, FKs, `CHECK`s, unique indexes. Session store. | — |
| **Backup** | Nightly `pg_dump`, encryption, offsite copy, retention | — |

**Same-origin deployment (REC, C-11).** The SPA and the API share one hostname, with `/api` proxied. That gives us no CORS, cookies scoped to the host, and simple CSRF.

---

## 3. Backend technology decision

The README proposes Spring Boot and notes that FastAPI is being considered. Below we compare the two against this project's concrete needs, not in general.

### What actually makes this backend hard

1. **Authentication with two OIDC providers**, server-side sessions, CSRF for a cookie-based SPA, and logout. Getting this wrong is the biggest security risk (VULN-01).
2. **Authorization** that depends on data: global role, membership, org role, per-room permission and object ownership. It has to be checked on every endpoint (RISK-04).
3. **Transactional integrity**: an exclusion constraint, re-validation on approval, optimistic locking, and per-organization quota checks under concurrency (RISK-01).
4. **Long-term maintenance by a volunteer or student organization** with developer turnover.

Raw throughput is **not** a hard part. Expected load is a few hundred users and well under 10 requests per second at peak (ASM).

### Comparison

| # | Criterion | Spring Boot (Java) | FastAPI (Python) | Edge |
|---|---|---|---|---|
| 1 | **Development complexity** | More ceremony: annotations, configuration and JPA concepts. But the hard parts for us (OIDC login, sessions, CSRF, method security) are mostly configuration in Spring Security. | Faster to the first endpoint. The hard parts must be assembled: Authlib for OIDC; a DB-backed session store, because Starlette's `SessionMiddleware` is a signed client-side cookie; a third-party CSRF middleware; slowapi for rate limits. | Spring, for *this* project |
| 2 | **Maintainability** | Strong conventions and static types, and the compiler catches refactoring errors across about 10 entities. Newcomers find code where they expect it. | Clean and readable. Type safety depends on discipline (mypy/pyright in strict mode). The structure is up to us, so it varies more between maintainers. | Spring (slightly) |
| 3 | **Auth & authorization** | `oauth2Login()` with multiple client registrations, Spring Session JDBC, `csrf().spa()`, `@PreAuthorize` with a custom permission evaluator, and `@AuthenticationPrincipal` to get the actor from the session (RISK-02). The audit's fixes are written in Spring terms. | Possible, but every piece is a separate library with its own defaults. "Identity only from session" has to be built by convention through dependencies. | **Spring (decisive)** |
| 4 | **Database integration** | Spring Data JPA/Hibernate covers CRUD. Range queries and `tstzrange` fit better in native SQL through `JdbcClient`. We must catch `23P01` (exclusion violation) from `DataIntegrityViolationException`. Flyway uses plain SQL migrations. Hibernate pitfalls to avoid: lazy loading/N+1 and Open Session in View (disable it). | SQLAlchemy 2 is excellent and gives more direct SQL control. Alembic autogenerate is convenient but needs review for constraints like `EXCLUDE`. | FastAPI (slightly) |
| 5 | **Testing** | JUnit 5, Testcontainers with `@ServiceConnection` (real PostgreSQL, so the exclusion constraint is tested for real), and `spring-security-test` (`oidcLogin()`, `@WithMockUser`), which makes the authorization matrix tests (C-18) cheap. | pytest is pleasant, and testcontainers-python works. Testing authenticated sessions needs more custom fixtures. | Spring |
| 6 | **Performance & concurrency** | Thread-per-request with virtual threads (Java 21+). That is simple blocking code with no async pitfalls. Correctness under concurrency comes from PostgreSQL, not the framework. | Async is fast but mixes sync and async (DB driver, libraries), which is a common bug source. Sync mode works fine at our load. | Neutral (load is tiny) |
| 7 | **Security** | Secure defaults: CSRF on, security headers, session fixation protection. Frequent CVEs, but patched quickly and announced clearly. | Smaller surface, but the security posture is whatever we assemble. Fewer defaults guard against mistakes. | Spring |
| 8 | **Deployment** | One fat JAR, image about 200 MB, 300–600 MB RAM, startup in seconds. Fine for Compose. | Image about 150 MB, 100–200 MB RAM. | FastAPI (irrelevant at our size) |
| 9 | **Long-term maintenance** | A Boot minor release every 6 months with about 13 months of OSS support, so we must upgrade at least yearly. Major upgrades (3→4) take real work. Java LTS releases are stable for years. | FastAPI is still 0.x, and the Pydantic v1→v2 migration was painful. Python versions have a 5-year life. Yearly upgrades are also needed. | Neutral |
| 10 | **Developer productivity** | Slower start. Productive once the skeleton exists. springdoc generates OpenAPI. | Very productive, with built-in OpenAPI docs. | FastAPI |

### Recommendation: Spring Boot (REC)

**Use Spring Boot 4.x on Java 25 LTS, with Spring Security, Spring Data JPA plus `JdbcClient` for range queries, Flyway, PostgreSQL, JUnit 5 and Testcontainers. Build with Maven.**

Why:

- The riskiest part of this system is authentication, sessions, CSRF and authorization. Spring Security gives us tested, documented, secure defaults for exactly that. In FastAPI we would assemble and own it ourselves.
- The existing artefacts already assume Spring. That includes the README's stack and the audit's remediation (Bean Validation, `@Version`, `@AuthenticationPrincipal`, Bucket4j), so they translate directly.
- FastAPI's advantages (less boilerplate, slightly nicer SQL) matter less here than the security plumbing.

**When to choose FastAPI instead.** Choose it if the people who will maintain the system for the next 2–3 years only know Python. A familiar stack maintained well beats a "better" stack nobody can maintain. In that case, the compensating measures are mandatory:

- A Postgres-backed server-side session table, not signed cookies.
- Authlib for OIDC.
- Explicit CSRF middleware.
- Sync SQLAlchemy.
- mypy in strict mode in CI.

This is listed as a must-confirm decision in `OPEN_QUESTIONS.md` (Q-01).

### Backend internal structure (REC)

Package by feature, with business logic in services. Controllers only map HTTP to service calls and resolve the actor.

```text
backend/src/main/java/no/vtvest/booking/
├── common/        Clock, ProblemDetail mapping, pagination, validation helpers
├── security/      SecurityConfig, OIDC user mapping, Actor resolver, CSRF, session config
├── user/          users, identities, /me
├── organization/  organizations, memberships, invitations
├── room/          rooms, opening hours, room_access, effective permission
├── booking/       BookingService, BookingRules (pure), BookingAuthorization, series, blocks
├── calendar/      range queries, ICS feed generation, feed tokens
├── notification/  notifications, email outbox job
├── audit/         AuditLog writer and admin query
└── admin/         settings, bulk operations
```

Rules for this structure:

- **`BookingRules` is pure Java**, with no Spring or DB, and takes the current time as an argument. It mirrors `bookingRules.ts`, so we can unit-test it exhaustively.
- **Authorization lives in services, not only in controller annotations.** Every service method takes an `Actor`, resolved from the session in the controller, and calls `XxxAuthorization`. Then the same checks apply to REST, ICS and scheduled jobs, and a forgotten annotation cannot open a hole.
- **Deny by default.** Every route in `SecurityConfig` requires authentication except `/api/v1/auth/providers`, the OIDC endpoints, `/ical/**` (token auth) and health checks.

---

## 4. Authentication

### Who needs to log in

- Students at the institutions Velferdstinget Vest serves. They all have **Feide**.
- Board members of student organizations. Usually students, but sometimes recent graduates, external volunteers or exchange students whose Feide access changes.
- Velferdstinget staff and administrators. They may or may not have Feide.

This means **no single identity provider covers everyone (ASM)**.

### Options evaluated

| Option | Fit | Verdict |
|---|---|---|
| **Feide (OIDC)** | The national identity for Norwegian education. Strong identity, institution-managed accounts, and MFA where the institution enforces it. **Caveats:** Velferdstinget must register as a service provider in the Feide customer portal, **and each institution must activate the service individually** before its users can log in ([Feide docs](https://docs.feide.no/service_providers/manage/access_to_services/activation.html)). Graduates lose access. | **Primary provider (REC)** |
| **Google (OIDC)** | Almost everyone has an account or can make one, and the integration is simple. Identity is self-asserted, which is acceptable because *authorization comes from memberships granted inside our system, not from the identity provider*. It sends login metadata to Google, but no booking data. | **Secondary provider (REC)**, covering people without Feide |
| Microsoft / Entra ID | Institutions' Microsoft accounts are already covered via Feide. Personal Microsoft accounts are rare in this group. | Not needed. It is one more client registration if it is ever requested. |
| GitHub | Developer audience only. | **Reject** |
| Email + password | We would own password hashing, reset flows, breach detection and MFA, and credential stuffing becomes a target. The audit says "avoid local passwords" (C-1). | **Reject** |
| Email magic link | No passwords, works for anyone with email. Needs reliable SMTP, and link security equals mailbox security. | **Optional fallback** (Phase 6), only if real users can use neither Feide nor Google |
| ID-porten / BankID (via Feide or directly) | Strong identity, but overkill, requires approval from Sikt, and excludes international students without a Norwegian national ID. | **Reject** for now |
| Self-hosted Keycloak as a broker | Federates Feide, Google and local accounts in one place. But it adds a stateful service to operate, upgrade and back up. | **Not for MVP.** Revisit if we need more than 3 providers or SAML. |

### Recommended solution (REC)

**Feide and Google via OIDC, using Spring Security `oauth2Login`, with server-side sessions. No local passwords. Organization membership is granted by invitation, not inferred from the identity provider.**

**Login flow**

```text
SPA "Logg inn med Feide" → GET /oauth2/authorization/feide → Feide → GET /login/oauth2/code/feide
→ API maps (provider, sub) → users row (create on first login) → session cookie → redirect to SPA
→ SPA calls GET /api/v1/me
```

**Identity mapping**

- Each login identity is a row in `user_identities (provider, subject)`.
- `sub` is the stable key. Email is *not* the key, because emails change and can be recycled.
- **Account linking:** a first-time identity whose `email_verified` email matches an existing user is linked to that user. Otherwise a new user is created. Users can also link a second provider explicitly while logged in (Phase 6).

**Onboarding**

- Anyone with Feide or Google can log in, but a new user has **no memberships**. They can view the calendar (see Q-05) but cannot book.
- Memberships are created when an organization admin (`ORG_ADMIN`) or a Velferdstinget admin invites the user (an email link) or adds them directly.
- This scales to hundreds of organizations, because Velferdstinget doesn't have to manage every member (Q-04).

**Admins**

- The `ADMIN` role is set only in the database: by an existing admin, or bootstrapped from an environment variable listing initial admin emails on first startup.
- It is never derived from an identity provider claim.
- **Recommendation:** admins log in with Feide or a Google account that has 2-step verification. We cannot reliably verify that from Google's claims, so this is policy, not a technical control (C-19).

### Sessions (REC, C-2)

- **Spring Session JDBC** stores sessions in PostgreSQL. Sessions survive API restarts and deploys, and there's no Redis to run.
- Cookie: `__Host-SESSION`, with `HttpOnly`, `Secure`, `SameSite=Lax` and `Path=/`.
  - `Lax` is required because the OIDC callback is a cross-site top-level GET.
  - The `__Host-` prefix forbids a `Domain` attribute.
- Timeouts: 8 hours idle and 7 days absolute (Q-21). After that, re-login is usually seamless through the identity provider's own SSO session.
- The session ID is rotated on login. Logout (`POST /api/v1/auth/logout`) invalidates the server-side session.
- **No tokens reach the browser.** Access and refresh tokens from the identity providers are only used during login and are not stored. This is effectively the BFF pattern, with the API acting as the BFF.
- **When a user is disabled**, their sessions are deleted immediately. We can query them by principal name in Spring Session JDBC.

### CSRF (C-3)

- Spring Security's SPA mode (`csrf.spa()`): the server sets an `XSRF-TOKEN` cookie, and the SPA echoes it in an `X-XSRF-TOKEN` header on every non-GET request.
- `SameSite=Lax` is defence in depth, not the main control.
- GET requests never change state. This includes the ICS feeds.

---

## 5. Authorization model

### Roles and relations

| Concept | Values | Stored in |
|---|---|---|
| Global role | `USER`, `ADMIN` | `users.global_role` |
| Organization role | `MEMBER`, `ORG_ADMIN` | `memberships.role` |
| Room permission for an organization | `DIRECT`, `REQUEST`, `NONE` | `room_access`, falling back to `rooms.default_permission` |
| Room approval override | `approval_required` caps `DIRECT` at `REQUEST` | `rooms.approval_required` |

**Effective permission**, computed in one place (`room/EffectivePermission`):

```text
if room.status != ACTIVE or org.status != ACTIVE      → NONE
p = room_access(room, org).permission ?? room.default_permission
if p == DIRECT and room.approval_required             → REQUEST
return p
```

Room defaults plus per-organization overrides are what make *hundreds* of organizations manageable. Most rooms only need a default ("all organizations: REQUEST") and a handful of exceptions. See `DATABASE_DESIGN.md` §4.

### Who can do what (summary)

The full per-endpoint matrix is in `API_DESIGN.md` §3.

| Action | USER (no membership) | MEMBER of org X | ORG_ADMIN of org X | ADMIN |
|---|---|---|---|---|
| View calendar (approved, title and org name) | ✓ (Q-05) | ✓ | ✓ | ✓ |
| View org X's pending requests and descriptions | — | ✓ | ✓ | ✓ |
| Book or request for org X | — | per effective permission | per effective permission | — (as member only) / on behalf of org X via admin tools |
| Cancel org X's booking | — | own bookings | all of org X's bookings | all |
| Manage org X's members and invitations | — | — | ✓ | ✓ |
| Approve or reject requests | — | — | — | ✓ |
| Rooms, permissions, blocks, settings | — | — | — | ✓ |

### Security rules every endpoint follows

1. **Identity comes only from the session** (RISK-02). Request DTOs have no `userId`, `actorId` or `requestedById` field. A test asserts that such fields are ignored.
2. **Object-level checks on every `{id}`** (RISK-04). Objects the actor may not see return **404, not 403**, so their existence is not leaked.
3. **Re-check, don't cache.** Membership and permission are read inside the transaction for every write, including on approval (VULN-04) and cancellation (VULN-07).
4. **Projections per role** (RISK-03). Calendar endpoints return a minimal event projection. Emails are visible only to admins and to the same organization's ORG_ADMINs.
5. **UUID identifiers**, generated by the database. Unguessable IDs are a bonus, not a control.

---

## 6. Security architecture (overview)

This maps the audit's controls to architectural decisions. Implementation tasks are in `DEVELOPMENT_PLAN.md`.

| Concern | Decision | Audit |
|---|---|---|
| Authentication | Feide and Google OIDC, server sessions, no passwords | VULN-01, C-1, C-2 |
| CSRF | `csrf.spa()`, header token | C-3 |
| XSS | React escaping (verified in audit §7), no HTML sinks, CSP from Nginx. ICS output is escaped per RFC 5545. Email templates are escaped (Thymeleaf text/HTML). | C-9 |
| Authorization | Service-layer checks, deny by default, 404 on invisible objects, authorization matrix tests | VULN-02, RISK-02, RISK-04, C-4, C-18 |
| Privilege escalation | `global_role` and `memberships.role` change only through admin/ORG_ADMIN endpoints, which are audited. An ORG_ADMIN cannot grant room permissions or the global admin role. Mass assignment is prevented with explicit request DTOs. | C-19 |
| Integrity | Exclusion constraint, `CHECK`s, FKs, `@Version` optimistic locking | RISK-01, C-5 |
| Input validation | Bean Validation on every DTO, DB length limits, 64 KB body cap (Nginx and Spring), control characters stripped, colour regex | VULN-06, RISK-06, C-6 |
| Business abuse | Max duration, horizon, quotas, duplicate-request unique index | VULN-03, VULN-05, C-7 |
| Rate limiting | Nginx `limit_req`: strict on `/oauth2/`, `/login/` and `/ical/`, moderate on `/api/`. Business quotas in the DB. Bucket4j only if Nginx proves insufficient. | C-8 |
| Headers & TLS | HSTS, CSP (audit C-9 policy, verified against FullCalendar inline styles), TLS 1.2+ | C-9, C-10 |
| Audit log | Append-only `audit_log` table. The app DB role has `INSERT`/`SELECT` only. | C-12 |
| Errors | RFC 9457 Problem Details, no stack traces, a request ID in each response | C-13 |
| Secrets | Docker Compose secrets mounted as files, read with Spring `configtree:`, nothing in git | C-14, HYG-01 |
| DB least privilege | Separate `booking_owner` (DDL, used only by Flyway) and `booking_app` (DML) roles | C-14 |
| Containers | Non-root, read-only root FS where possible, DB on an internal-only network, pinned image digests | C-15 |
| Supply chain | Renovate, `npm audit`, OWASP Dependency-Check or Trivy, gitleaks in CI | C-17, DEP-01 |
| Privacy (GDPR) | Minimal data (name, email, provider subject), role-scoped exposure, retention jobs, a privacy notice. Velferdstinget is the data controller (Q-08). | RISK-03, C-16 |

### Account and organization lifecycle

| Event | System behaviour (REC; defaults in `OPEN_QUESTIONS.md`) |
|---|---|
| User removed from org | Membership row deleted and audited. Their **pending** requests for that org are auto-rejected with a system comment (VULN-04). Approved bookings stay, because they belong to the org. They lose cancel rights immediately (VULN-07). |
| Membership expires (`expires_at`) | Nightly job behaves as above. Supports a yearly board turnover without manual cleanup. |
| Org access to room downgraded to `NONE` | Pending requests for that org and room are auto-rejected. Future approved bookings are kept but flagged for admin review (Q-14). |
| User disabled | Sessions deleted, calendar feed tokens revoked, pending requests auto-rejected. History kept. |
| User deletion request (GDPR) | User is anonymized ("Slettet bruker", email removed, identities deleted). Booking rows keep the anonymized reference. |
| Org archived | No new bookings, pending requests rejected, future bookings cancelled (with notification), history kept, hidden from pickers. Reversible with `restore`. |
| Room archived | As for an archived org. `DISABLED` instead keeps the room visible but not bookable, for example during renovation. |

---

## 7. Frontend evolution

**REQ:** The frontend stays a client-side rendered SPA (React + Vite). No SSR and no Next.js.

### Data layer

**The current model** is that `AppProvider` loads the entire `DemoData` and reloads all of it after every mutation. That cannot work with real data volumes or with privacy rules.

**The new model** splits responsibilities:

| State | Holder |
|---|---|
| Server state (calendar ranges, lists, `/me`) | **TanStack Query** (REC, new dependency) |
| UI state (open dialogs, toasts, calendar preferences) | React context, as today: a slimmer `AppProvider` |
| Session user | `useMe()` query; `AuthGate` component |

**Why TanStack Query is worth a dependency.** It solves concrete problems we would otherwise hand-roll:

- Caching per calendar range (`['calendar', from, to, roomIds]`).
- Targeted invalidation after mutations, instead of a global reload.
- Loading and error states.
- Refetch on window focus, which picks up other users' changes.
- Optimistic updates with rollback for drag and drop.

**What we don't need:**

- **Redux or Zustand.** No complex client-only state exists.
- **zod runtime validation of API responses.** It is same-origin and first-party, and we get types from the OpenAPI spec. VULN-08's concern was corrupted localStorage, which goes away.
- **A mock adapter kept alongside the real API.** Two implementations of the rules would drift. Development runs against the real backend in Docker Compose.

**API types.** Generate TypeScript types from the backend's OpenAPI document with `openapi-typescript` (dev dependency only). A thin hand-written `apiFetch` wrapper:

- adds `X-XSRF-TOKEN`
- parses Problem Details into an `ApiError` with `code`, keeping today's `BookingError.code` contract so `lib/errors.ts` keeps working
- redirects to `/logg-inn` on 401

### Migration path for the existing code

| Today | Production |
|---|---|
| `bookingService.ts` (localStorage) | `api/` modules (`bookings.ts`, `rooms.ts`, …) calling `apiFetch`. The `actorId` parameters are removed (RISK-02). |
| `bookingRules.evaluateBooking` (full rule set on full data) | **Shrunk** to cheap UX prechecks: time validity, and permission from `GET /me/bookable-rooms`. Authoritative feedback comes from `POST /api/v1/bookings/preview` (dry run, debounced 300 ms). This avoids keeping two full rule implementations in sync. |
| `AppProvider.data` | Per-page queries: `useCalendarEvents(range, rooms)`, `useMyBookings(tab, page)`, `useAdminQueue(filters)` |
| `UserSwitcher` | Account menu (name, organizations, "Logg ut") |
| Admin "Rom og tilganger" matrix | Searchable, paginated admin pages (below) |
| `decisionSeen` bell | `GET /me/notifications`, polled every 60 s and on focus |

### Loading, errors and concurrent changes

- Every query has explicit loading, empty and error states. We already have `EmptyState` and `Alert`.
- **Problem Details mapping:**
  - `CONFLICT` (409): show the conflicting time range and refetch the range.
  - `VERSION_CONFLICT` (409): "Bookingen er endret av noen andre", then refetch and reopen.
  - `RULE_VIOLATION` (422): list the `violations`.
  - 401: redirect to login.
  - 5xx: generic message with the request ID.
- **Optimistic UI only for drag and resize**, where instant feedback matters. All other mutations wait for the server response, then invalidate.

### Drag and drop, resize

- Use FullCalendar `editable` with a **per-event** `editable` flag computed by the server (`canEdit` in the calendar projection). It is true for:
  - your organization's `DIRECT`-permission bookings,
  - your own `PENDING` requests,
  - everything, for admins.
- `eventDrop` and `eventResize` call `PATCH /api/v1/bookings/{id}` with `{ start, end, version }`. On error, call `info.revert()` and show a toast. On success, invalidate the range.
- Moving between rooms is not possible in week view, which has no room axis. Use the details dialog to change the room.

### Many rooms and organizations

- **Sidebar room filter:**
  - Search box, grouping by `building`, "Mine rom" (rooms my orgs can book), select all or none per group.
  - The selection is saved in localStorage, as today.
- **Room-availability day view (optional, Phase 5):** a custom "rom × tid" grid for one day, showing which rooms are free.
  - FullCalendar's resource-timeline view does this out of the box, but it is a **Premium** plugin. It is free under GPLv3 only if this project is open-sourced (Q-27).
  - Otherwise, build a simple custom grid.
- **Admin pages**, each with server-side search, filters, pagination and lazy-loaded routes:
  - `/admin/sokander`: queue with filters by room, org and date. Bulk approve for non-conflicting requests.
  - `/admin/rom` and `/admin/rom/:id`: details, opening hours, limits, a permissions tab with an org search, and bulk set.
  - `/admin/organisasjoner` and `/admin/organisasjoner/:id`: members, room access, bookings.
  - `/admin/brukere`.
  - `/admin/logg`: audit log.
- **Bulk permission UI:** select N organizations (search, select all results), then "Sett tilgang til Storsalen: Søknad", then preview the change count, then apply. Also "Kopier tilganger fra rom …".
- **Org admin pages** (`/organisasjoner/:id`): members, invitations, the org's bookings.

### Recurring events in the UI

- Add a "Gjentas" section to the booking dialog: none, weekly, or every second week; weekdays; end date.
- **Preview** lists every occurrence with its status: ok, conflict, or rule violation. The user chooses "book the available ones" or "cancel".
- Series occurrences show a repeat icon. Details offer "Avlys denne" or "Avlys denne og senere".

### Time zone

- The business time zone is `Europe/Oslo` (RISK-05). Almost all users are in Norway.
- **REC:** keep FullCalendar on `timeZone: 'local'`, and show a banner if `Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Europe/Oslo'`. Avoid the extra Luxon plugin until it is needed.
- `lib/dates.ts` formatting should pass `timeZone: 'Europe/Oslo'` explicitly.
- The server rejects DST-gap local times.

### Other frontend changes

- Lazy-load the admin routes (`React.lazy`). The bundle is ~180 kB gzip today.
- Pin a Node LTS version (`engines`, Docker base image) (HYG-02).
- Upgrade Vitest (DEP-01).
- New dev-only dependencies: `@testing-library/react`, `jsdom`, `msw`, `@playwright/test`, `openapi-typescript`.

---

## 8. Calendar integrations

### MVP: read-only ICS subscription feeds (REC)

| Aspect | Decision |
|---|---|
| Feed types | **Room feed** (approved bookings in one room), **organization feed** (the org's approved bookings, with pending ones optional and prefixed "[Søknad]"), **personal feed** (bookings of all my organizations) |
| Access | Each feed is a personal, revocable secret URL: `https://<host>/ical/<token>.ics`. The token is 256 bits of randomness, and only its SHA-256 hash is stored. |
| Content and privacy | Computed **at request time** with the feed owner's *current* permissions. Losing a membership shrinks the feed automatically. Room feeds show title and org name (the same visibility as the web calendar). Descriptions are only in org and personal feeds. |
| Revocation | Users revoke or regenerate feeds in "Innstillinger". Disabling a user revokes all of their feeds. |
| Changes & cancellations | Stable `UID: <booking-uuid>@<host>`, `SEQUENCE` = booking `version`, `LAST-MODIFIED`. Cancelled and rejected bookings are **omitted**; subscription clients replace the whole feed, so the events disappear. |
| Recurring | Each occurrence is a separate `VEVENT`, because series are materialized (`DATABASE_DESIGN.md` §6). No `RRULE`/`EXDATE`, which avoids client incompatibilities. |
| Window | 30 days back to 12 months ahead |
| Times | UTC (`DTSTART:20261014T160000Z`). No `VTIMEZONE` needed. |
| Library | ical4j (handles escaping and line folding correctly) |
| Caching | `ETag`, `Cache-Control: private, max-age=300`, Nginx rate limit per IP |

**Google Calendar compatibility.** "Add calendar from URL" works with any public HTTPS `.ics` URL. Be aware of two things:

1. Google fetches from *its* servers, so `/ical/` must be reachable from the internet, even if the rest of the app were restricted.
2. Google refreshes on its own schedule, roughly every 8–24 hours, and we cannot control it.

Tell users that changes can take up to a day to appear in Google. Apple Calendar and Outlook refresh more often.

### Not recommended

- **Two-way Google Calendar sync.** It needs a Google Cloud project, OAuth consent review, per-user tokens, conflict resolution between two sources of truth, and webhook infrastructure. It conflicts with "our system enforces the rules" and with self-hosting. No strong reason exists.
- **Live import from Google Calendar.** Same problems.

### One-time import of existing calendars (Phase 6, if needed)

Velferdstinget probably has existing room calendars in Google Calendar (Q-02). Plan:

1. An admin exports `.ics` per room from Google.
2. An admin-only import tool maps each event to a room and organization (by title pattern or manually), shows a **dry run** with conflicts and unmapped events, then imports as `APPROVED` bookings created by the admin, with an audit entry.
3. Recurring Google events are expanded within the horizon.

This is a migration tool, not a sync.

---

## 9. Deployment architecture

**REQ:** self-hosted on Velferdstinget's own servers, Docker Compose, Nginx, no external cloud services needed for operation. Feide and Google are used for login only.

### Containers

| Service | Image | Networks | Ports | Notes |
|---|---|---|---|---|
| `web` | Built from `nginxinc/nginx-unprivileged` with SPA `dist/` and config | `edge`, `app` | 443, 80 on the host | TLS, headers, static files, proxy. Alternatively, use plain HTTP behind the host's existing reverse proxy (Q-09). |
| `api` | Built from `eclipse-temurin:25-jre` (or distroless), non-root | `app`, `db` | none | `/actuator/health` on a separate management port, not proxied |
| `db` | `postgres:18` (pinned digest) | `db` (`internal: true`) | **none** | Volume `pgdata` |
| `backup` | Small image with `pg_dump` and `restic` | `db` | none | Cron: nightly dump, encrypt, push offsite |

- **TLS:** Let's Encrypt via certbot (webroot challenge) in `web`, or the host's or institution's certificate.
  - If the host (for example fribyte, Q-09) already runs a reverse proxy with TLS, `web` serves HTTP on the internal network only, and the outer proxy handles certificates.
  - Caddy would make automatic HTTPS simpler, but Nginx is the stated choice and works fine.
- **Startup order:** `depends_on: condition: service_healthy` (`db` before `api` before `web`).

### Configuration and secrets

- `deploy/.env` holds non-secret configuration: hostname, enabled providers, SMTP host. It is generated from `.env.example`. A root `.gitignore` covers `.env*`, `*.pem` and `*.key` (HYG-01).
- Secrets are Compose `secrets:` files with mode `0600`, outside the repo, mounted into `/run/secrets` and read with `spring.config.import=configtree:/run/secrets/`. They include:
  - DB passwords (owner and app)
  - Feide and Google client secrets
  - SMTP password
  - restic password
- Flyway runs at API startup with the **owner** credentials (`spring.flyway.user/password`). The application datasource uses the DML-only `booking_app` role.

### Backups and restore

| Item | Default (Q-20) |
|---|---|
| Method | Nightly `pg_dump -Fc`, plus a dump before every deploy |
| Storage | `restic`-encrypted repository on a **different machine/site** |
| Retention | 7 daily, 4 weekly, 12 monthly |
| RPO / RTO | 24 h / 4 h. WAL archiving for point-in-time recovery is not needed at this scale. |
| Restore test | Quarterly: restore into staging and run a smoke test. The procedure is documented in `deploy/RESTORE.md`. |
| Monitoring | Alert if no successful backup in 26 hours |

### Logging and monitoring

- **Logs:** the API logs structured JSON to stdout (Spring Boot structured logging) with a request ID. No personal data beyond user IDs.
  - Nginx keeps access logs (IP addresses) for 14 days.
  - Docker `json-file` driver with `max-size`/`max-file` rotation.
- **Health:** Compose healthchecks on `db` (`pg_isready`), `api` (`/actuator/health/readiness`) and `web`.
- **Monitoring (REC, simple):** self-hosted **Uptime Kuma**, or the host's existing monitoring. It watches the public health URL, certificate expiry, backup freshness (via a heartbeat push) and disk space. Alerts go by email.
- Prometheus and Grafana only if a concrete need appears.

### Environments

| Env | Where | Identity | Data |
|---|---|---|---|
| **dev** | Developer laptop: `docker compose -f compose.dev.yml` (db and a mock OIDC server) plus `npm run dev` with a Vite proxy to the API | `mock-oauth2-server` (navikt), with logins for any test user | Dev seed migration (ported from `mockData.ts`) |
| **staging** | Same server or a small VM, same Compose file, separate DB and volume | Feide test environment and a Google test client | Anonymized restore or seed |
| **prod** | Production server | Feide production and Google | Real |

### Deployment and rollback

1. CI builds versioned images (`api:1.4.0`, `web:1.4.0`, plus the git SHA) and pushes them to a registry: GHCR, or a self-hosted registry if one is required.
2. Deploy:
   1. `backup now`
   2. `docker compose pull`
   3. `docker compose up -d`
   4. smoke check (`/api/v1/health`, login page)
3. **Rollback:** set the previous tag and run `up -d`.
   - **Migrations are always backward compatible (expand/contract).** The previous app version must run on the new schema. Destructive changes ship in a later release.
   - If data is corrupted, restore from the pre-deploy dump.
4. Staging always gets a release first.

### Security updates

- Host: unattended security upgrades.
- Images: rebuilt weekly to pick up base-image patches. Trivy scan in CI.
- Dependencies: Renovate PRs. Patch versions are merged weekly after CI passes. Minor and major versions are reviewed monthly.
- Spring Boot minor upgrade at least every 6–12 months, to stay inside OSS support.

### Resources

All of production fits comfortably on **2 vCPU, 4 GB RAM and 40 GB SSD**: API about 1 GB with JVM heap capped, Postgres about 1 GB, Nginx trivial. Staging can share the host if resources allow, with separate networks and volumes.
