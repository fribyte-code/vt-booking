# Development Plan

The roadmap from the frontend prototype to a production system. **Status:** proposal for review. Labels (REQ/REC/ASM) are explained in [`ARCHITECTURE.md`](ARCHITECTURE.md).

**Guiding priority (REQ):** a *secure, working booking system* before advanced features.

- Phases 0–4 deliver the README's MVP, hardened, in front of real users as a **pilot**.
- Phases 5–6 add the advanced calendar features and integrations.

---

## 1. Phase overview

We reorganized the suggested phases. There are three changes:

1. A short **Phase 0** handles the decisions with long lead times (Feide, hosting) and the audit's quick fixes.
2. **Deployment work starts in Phase 1** (staging from week one), not at the end. That avoids late infrastructure surprises.
3. **Basic booking limits move into Phase 3.** They are security fixes (VULN-03, VULN-05), not "advanced features".

| Phase | Goal | Relative effort | Rough size* |
|---|---|---|---|
| 0 | Decisions, hygiene, executable rule spec | S | ~1 week |
| 1 | Foundation: repo, backend skeleton, schema, CI, staging | M | 2–3 weeks |
| 2 | Identity, organizations, rooms, permissions | L | 3–4 weeks |
| 3 | Core booking on the backend, and SPA integration | L | 4–5 weeks |
| 4 | Production hardening and **pilot launch (MVP)** | M | 2–3 weeks |
| 5 | Advanced calendar: drag/resize, recurrence, fixed reservations, blocks, configurable restrictions | L | 4–6 weeks |
| 6 | Integrations and admin at scale: ICS, email, bulk permissions, import, audit viewer | M–L | 3–5 weeks |
| 7 | Operations (continuous) | — | ongoing |

\*Rough sizes assume one experienced full-stack developer working full time. Part-time student contributors should multiply by 2–3. These numbers are for ordering and comparing phases, not commitments.

```text
P0 ──▶ P1 ──▶ P2 ──▶ P3 ──▶ P4 (pilot) ──▶ P5 ──▶ P6
 │              ▲                    ▲
 └─ Feide registration & institution activation (external lead time) ──┘
```

Phases 5 and 6 are largely independent of each other and can overlap if there are two developers.

---

## Phase 0: Decisions and preparation

**Objectives**

- Unblock the foundations.
- Start the external processes that have long lead times.
- Make the prototype's rule set complete and tested, so it can serve as the specification for the backend.

**Tasks**

1. Review these documents with Velferdstinget and get answers to section A of `OPEN_QUESTIONS.md`:
   - Q-01 (backend and maintainers)
   - Q-07 and Q-30 (login, Feide)
   - Q-04, Q-05, Q-06 (org admins, visibility)
   - Q-08 (GDPR)
   - Q-09 (hosting, hostname)
2. Start **Feide service registration** in the customer portal and contact the relevant institutions about activation. Create a **Google OAuth client** (internal testing mode).
3. Repo hygiene (audit Phase 0):
   - Root `.gitignore` covering `.env*`, `*.pem`, `*.key`, `.vite/`, `node_modules/`, `dist/` (HYG-01).
   - Unstage `.vite/` (HYG-03).
   - `engines` set to Node 24 LTS (HYG-02).
   - Upgrade Vitest to ≥ 4.1.11 (DEP-01). Do **not** use `npm audit fix --force`.
4. Add the audit's nine PoCs (SECURITY_AUDIT Appendix A) to `bookingService.test.ts` as **expected-behaviour tests**, marked `todo` or `fails`. Together with the existing six tests, they become the executable spec for the backend's `BookingRules`.
   - *Optional:* implement VULN-03/04/05/06/07 in the prototype rules. Only worth it if the prototype is used for more demos; otherwise go straight to the backend.
5. Set up a CI workflow for the existing frontend: `lint`, `tsc -b`, `test`, `build`, `npm audit --omit=dev`, gitleaks.

**Dependencies:** none.

**Acceptance criteria**

- Section A questions are answered or explicitly accepted with defaults.
- Feide registration has been submitted.
- CI is green on `main`.
- Vitest has been upgraded.
- PoC tests are in the repo.

**Risks**

- Decisions drag on. *Mitigation:* the defaults are documented; proceed with them and change later where cheap.
- Feide activation takes months. *Mitigation:* Google covers the pilot.

---

## Phase 1: Foundation

**Objectives**

- A running backend skeleton with real authentication against a mock identity provider.
- The core schema with the double-booking guarantee proven by tests.
- CI.
- A staging environment that deploys automatically.

**Tasks**

1. **Repo layout** (monorepo). The frontend folder is kept as is, to preserve history and the existing documentation; renaming it to `frontend/` is optional.

   ```text
   backend/                 Spring Boot (Maven), Java 25
   velferdstinget-booking/  React SPA
   deploy/                  compose.yml, compose.dev.yml, nginx/, backup/, RESTORE.md, .env.example
   docs/
   ```

2. **Backend skeleton:**
   - Spring Boot 4.x with web, security, oauth2-client, data-jpa, validation, actuator, flyway, session-jdbc and springdoc.
   - Package layout per `ARCHITECTURE.md` §3.
   - `Clock` bean.
   - `ProblemDetail` exception handler with the stable `code` field.
   - Request-ID filter and structured JSON logging.
3. **Security baseline:**
   - `oauth2Login` against **`mock-oauth2-server`** in dev and CI.
   - Spring Session JDBC.
   - `__Host-SESSION` cookie.
   - `csrf.spa()`.
   - Deny-by-default route config.
   - `GET /api/v1/me`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/providers`.
   - Admin bootstrap from the `INITIAL_ADMIN_EMAILS` environment variable.
4. **Schema `V1`:** all core tables from `DATABASE_DESIGN.md` §3, the DB roles (`booking_owner`, `booking_app`), and a dev seed ported from `mockData.ts`.
5. **Proof tests** (Testcontainers, PostgreSQL 18):
   - The exclusion constraint rejects overlap.
   - Back-to-back bookings are allowed.
   - Cancelled bookings don't block.
   - **Concurrency:** 20 parallel inserts or approvals for the same slot leave exactly one `APPROVED` row.
6. **OpenAPI contract** for Phases 2–3 (`API_DESIGN.md`), reviewed before implementation. Generate TS types into the SPA (`openapi-typescript`).
7. **Deployment:**
   - `deploy/compose.yml` (web, api, db, backup).
   - Nginx config with security headers and a CSP in **report-only** mode at first.
   - Staging server.
   - CI builds images and deploys `main` to staging.
8. **Dev environment:**
   - `compose.dev.yml` (db and the mock OIDC server).
   - A Vite dev proxy for `/api`, `/oauth2` and `/login`.
   - A short `backend/README.md`.

**Dependencies:** Q-01 (language). The Phase 0 hostname decision is needed for staging.

**Acceptance criteria**

- Login via the mock identity provider works in dev and CI. `GET /me` returns the user. Without a session, every other endpoint returns 401.
- A state-changing request without a CSRF header returns 403.
- Flyway migrates an empty DB. Hibernate `validate` passes.
- The concurrency test passes reliably in 50 consecutive CI runs.
- Staging is reachable over HTTPS, and DB ports are not exposed (verified with `nmap` from outside).

**Risks**

- Spring Boot 4 and Spring Security 7 differ from older tutorials. *Mitigation:* follow the official reference docs and pin versions.
- The CSP breaks FullCalendar. *Mitigation:* report-only first, then fix, then enforce in Phase 4.

---

## Phase 2: Identity, organizations and rooms

**Objectives**

- Real login with Google, and Feide when it is activated.
- Users, organizations, memberships with org admins, rooms, and room permissions managed through the API and admin UI.

**Tasks**

1. **Backend:**
   1. Google and Feide client registrations.
   2. Identity mapping to `user_identities`, and linking by verified email (`ARCHITECTURE.md` §4).
   3. `last_login_at`, and a `LOGIN` audit entry.
2. **Organizations:**
   1. CRUD, archive and restore.
   2. Members (add, change role, remove, leave), with the "last ORG_ADMIN" guard.
   3. Invitations: create, email (logged to the console until SMTP exists), accept, expire, revoke.
3. **Rooms:**
   1. CRUD, archive and restore.
   2. Opening hours (stored; enforcement comes in Phase 3).
   3. `default_permission`, `approval_required`.
   4. `room_access` get/put.
   5. The `EffectivePermission` service with unit tests.
4. **Read endpoints:** `/rooms`, `/organizations`, `/me/bookable-rooms`, `/admin/users`.
5. **Audit log writer.** Every membership, role, room and permission change is recorded.
6. **Authorization matrix test harness:** parameterized tests over (actor fixture × endpoint × expected status), per `API_DESIGN.md` §3. It grows with every phase.
7. **SPA:**
   1. Login page with provider buttons.
   2. `AuthGate`.
   3. `apiFetch` with CSRF, Problem Details and 401 handling.
   4. TanStack Query setup.
   5. `useMe()` replaces `currentUser`.
   6. An **account menu** replaces `UserSwitcher`.
   7. Lazy-loaded admin routes:
      - rooms: list, detail, edit, permissions tab
      - organizations: list, detail, members
      - users: list, role and status
8. **SPA, org admin pages:** members and invitations.

**Dependencies:** Phase 1. A Google client exists (Phase 0).

**Acceptance criteria**

- A new Google user can log in and sees no booking ability. After accepting an invitation, they are a member.
- An ORG_ADMIN can manage only their own organization. Matrix tests prove that U3 cannot modify org A and cannot make itself an admin (vertical and horizontal escalation).
- Changing the global role is only possible for ADM, and it is audited.
- The user directory and emails are visible only to ADM, and member emails only to OA(org) (RISK-03).
- The admin can create a room, set default REQUEST, and override 3 orgs to DIRECT. `/me/bookable-rooms` reflects it.
- The SPA still renders the calendar. Bookings remain on the local mock until Phase 3, behind the existing service seam.

**Risks**

- Account linking edge cases: same person, different emails. *Mitigation:* no automatic merge without a verified email match. Admin merge is out of scope; explicit linking comes in Phase 6.
- Admin UI scope creep. *Mitigation:* plain searchable tables first; no matrix UI.

---

## Phase 3: Core booking system

**Objectives**

- Bookings persisted on the server, with every rule enforced server-side and in the database.
- The SPA fully on the API.
- The prototype's localStorage service removed.

**Tasks**

1. **`BookingRules` (pure Java):**
   1. Port `evaluateBooking`.
   2. Add max duration, max advance window, minimum notice, opening hours, no crossing midnight, and quotas.
   3. Add `RULE_VIOLATION` collecting all violations.
   4. Unit tests covering the six prototype scenarios, the nine PoCs and the new rules.
2. **`BookingService`:**
   1. create, with the per-org lock (`DATABASE_DESIGN.md` §5)
   2. preview
   3. cancel (membership-based; VULN-07)
   4. approve (full re-validation; VULN-04)
   5. reject (reason required)
   6. `23P01` → 409
   7. `@Version`
   8. audit entries and in-app notifications
3. **Lifecycle hooks:** membership removal or expiry and permission set to NONE auto-reject pending requests. Nightly job for expiries.
4. **Endpoints:**
   - `/calendar/events` (range-capped, role-scoped projection, `canEdit`)
   - `/rooms/{id}/busy`
   - `/bookings/**`
   - `/me/bookings`, `/me/notifications`
   - `/admin/bookings`, `/admin/bookings/{id}/competing`
5. **SPA integration:**
   1. Replace `bookingService.ts` with the `api/` modules, and remove `actorId` (RISK-02).
   2. `CalendarPage` fetches by visible range.
   3. `BookingDialog` uses `bookable-rooms` and a debounced `preview`.
   4. `MyBookingsPage`, `AdminPage` queue and history, and `NotificationsMenu` move to their endpoints.
   5. Loading, error and empty states everywhere.
   6. Error mapping per `ARCHITECTURE.md` §7.
6. **Remove prototype-only code (C-20):**
   - `UserSwitcher`
   - `resetDemoData` and the "Tilbakestill demodata" button
   - `mockData.ts` (moved to the backend seed)
   - localStorage domain data
   - the prototype banner in the sidebar
   - `decisionSeen`
7. **Shrink `bookingRules.ts`** to UX prechecks. Port the frontend tests: service tests move to the backend; component tests are new.
8. Room filter sidebar: search and grouping by `building`.

**Dependencies:** Phase 2.

**Acceptance criteria**

- The README's walkthrough (the prototype README's "Suggested walkthrough") works end to end on staging with real login, executed as a Playwright E2E test.
- The concurrency test passes for create *and* approve.
- All nine audit PoCs fail against the API, meaning the attack is prevented. They are kept as regression tests:
  - F-01 self-approval
  - F-03 five-year booking
  - F-04 1 MB title
  - F-05 500 requests
  - F-06 approval after revoke
  - F-07 ex-member cancel
  - F-08 malformed data
  - mass assignment
- The authorization matrix covers every booking endpoint.
- `grep` finds no `actorId`, `localStorage` domain keys or mock data in the SPA build.
- The calendar's week view loads in under 300 ms (API p95) with 5,000 bookings seeded.

**Risks**

- Porting live feedback without the full data set. *Mitigation:* the preview endpoint; accept a ~300 ms debounce.
- Visibility rules make conflict messages less informative. *Mitigation:* the message shows "Opptatt (Organisasjon X)" for approved bookings only. That's the agreed level (Q-05).
- Time zone bugs. *Mitigation:* fixed-clock tests around DST dates (last Sunday of March and of October).

---

## Phase 4: Production hardening and pilot launch

**Objectives**

- Meet every item in SECURITY_AUDIT §10 that applies to the MVP.
- Go live with a small group of pilot organizations and rooms.

**Tasks**

1. Nginx:
   - Enforce the CSP.
   - HSTS.
   - `limit_req` zones for `/oauth2/`, `/login/`, `/api/` and later `/ical/`.
   - Body size limits.
   - TLS configuration that scores A on SSL Labs.
2. Containers: non-root, read-only root file systems where possible, pinned digests, `internal: true` DB network, secrets via files and `configtree:`.
3. Backups:
   1. Nightly `pg_dump` and restic offsite.
   2. Pre-deploy dump.
   3. Write `deploy/RESTORE.md`.
   4. **Perform and time a full restore on staging.**
4. Monitoring: Uptime Kuma (or the host's tool), certificate expiry, backup heartbeat, disk usage, email alerts.
5. Basic email (if SMTP is available, Q-17):
   - New request to admins
   - Decision to the requester
   - Invitation
   - All via the `notifications` outbox job
6. Security testing:
   - OWASP ZAP baseline scan against staging, authenticated.
   - Manual test of the audit's checklist.
   - Review of session cookie flags, logout invalidation, CSRF and IDOR on every `{id}` endpoint.
7. GDPR: privacy notice page in the SPA, record of processing (draft for Velferdstinget), retention jobs enabled.
8. Runbooks in `deploy/`: deploy, rollback, restore, rotate secrets, add admin, incident contacts.
9. Production environment provisioned. Real rooms, organizations and pilot ORG_ADMINs entered.
10. Pilot: 3–5 organizations and 2–3 rooms for 2–4 weeks, with a feedback channel.

**Dependencies:** Phase 3. Q-08 (privacy), Q-09 (hosting), and SMTP if email is included.

**Acceptance criteria**

- Every SECURITY_AUDIT §10 checklist item is checked, or explicitly deferred with a reason. Deferral is only allowed for items covered by Phase 5–6 features, such as ICS rate limits.
- A restore from an offsite backup to a fresh VM succeeds within the RTO (4 hours).
- ZAP finds no High or Medium findings.
- Trivy and dependency scans show no unresolved High or Critical findings in production dependencies.
- The pilot runs 2 weeks without data-integrity incidents.

**Risks**

- Hosting environment constraints, such as no outbound SMTP or fixed reverse proxy rules. *Mitigation:* clarify Q-09 in Phase 0, and run staging on the same host type.
- Feide not yet activated. *Mitigation:* pilot with Google.

> **This completes the README's MVP:** login, organizations, rooms and access control; calendar views; direct booking without double booking; request-based booking; admin approval.

---

## Phase 5: Advanced calendar features

**Objectives**

- Drag and resize.
- Recurring bookings.
- Fixed reservations and blocks.
- Fully configurable restrictions.
- Room administration polish.

**Tasks**

1. **Drag and resize:**
   1. `PATCH /bookings/{id}` with the reschedule rules (Q-15).
   2. FullCalendar `editable` per event from `canEdit`.
   3. `eventDrop`/`eventResize` with optimistic updates and `info.revert()` on error.
   4. A `VERSION_CONFLICT` refresh flow.
2. **Recurring bookings:**
   1. `booking_series` endpoints with preview and the `onConflict` policies.
   2. Expansion in `Europe/Oslo`.
   3. Series approve and reject.
   4. UI: the "Gjentas" section, occurrence preview, series icon, "Avlys denne / denne og senere".
3. **Fixed reservations and blocks:** admin endpoints and UI (`/admin/bookings` create on behalf, block creation with conflict listing). Blocks are rendered distinctly ("Stengt").
4. **Restrictions admin UI:**
   - per-room overrides
   - opening hours editor
   - `system_settings` page
   - org quota overrides
   - the "approval required" switch
5. **Room availability view** (optional): a custom rooms × time day grid, or FullCalendar Premium if Q-27 allows.
6. Admin queue improvements: filters, bulk approve of non-conflicting requests, and showing competing requests side by side.

**Dependencies:** Phase 3. Phase 4 should be live, so pilot feedback can shape this phase.

**Acceptance criteria**

- Dragging a booking onto a conflicting slot reverts it and shows the conflict. Dragging to a valid slot persists after reload. A drag by someone without `canEdit` is impossible in the UI and returns 403 or 409 from the API.
- A weekly series across the DST change keeps its local start time (18:00 before and after).
- `SKIP_CONFLICTS` creates N−k occurrences and reports k.
- A block over existing bookings is refused with a list of them. A block over a free slot prevents bookings.
- Every Phase 5 endpoint is in the authorization matrix.

**Risks**

- Recurrence complexity creeping in, such as monthly rules or series editing. *Mitigation:* the scope is fixed in `DATABASE_DESIGN.md` §6. Anything more needs a new decision.
- FullCalendar interaction tests are flaky. *Mitigation:* test drag and drop in Playwright, not in jsdom.

---

## Phase 6: Integrations and administration at scale

**Objectives**

- External calendars.
- Full notifications.
- Admin tools that handle hundreds of organizations.

**Tasks**

1. **ICS feeds:**
   1. `calendar_feeds` CRUD.
   2. `/ical/{token}.ics` with ical4j, the ETag and cache headers, and Nginx rate limits plus token redaction in logs.
   3. Settings UI with copy-URL and instructions for Google, Apple and Outlook.
2. **Notifications:**
   1. Complete the email set (admin cancellations, auto-rejections, digest).
   2. Per-user email preferences.
3. **Bulk permissions:**
   1. `/admin/room-access/bulk` and `/copy` with dry run.
   2. UI: multi-select organizations, preview, apply.
4. **Audit log viewer**, and org-scoped activity for ORG_ADMINs.
5. **Calendar import tool** (if Q-02 says yes): an ICS upload with mapping, a dry run, and import.
6. **Optional:**
   - Explicit account linking (add a second login provider).
   - Magic-link login fallback, if pilot users need it.
   - Organization categories (Q-16), only if bulk editing proves insufficient.

**Dependencies:** Phase 3. SMTP (Q-17).

**Acceptance criteria**

- A feed added to Google Calendar shows bookings. A revoked token returns 404. A cancelled booking disappears from the feed. A feed token never appears in logs.
- An admin sets REQUEST for 200 organizations on a room in one operation, after a dry run, with one audit entry.
- Import of a sample Google export creates the expected bookings and reports conflicts without creating them.

**Risks**

- Google's refresh delays confuse users. *Mitigation:* say so in the UI.
- Email deliverability (SPF/DKIM). *Mitigation:* use the institutional or host mail relay.

---

## Phase 7: Operations (continuous)

- Renovate PRs every week. Spring Boot minor upgrade every 6–12 months. Rebuild base images.
- Quarterly restore test. Yearly review of access and admins.
- Security review or penetration test before each major release (SECURITY_AUDIT §9, item 17).
- Review booking limits against usage data each semester.

---

## 2. Testing strategy

### Test pyramid and tools

| Level | Backend | Frontend |
|---|---|---|
| Unit | JUnit 5: `BookingRules`, `EffectivePermission`, recurrence expansion, ICS rendering. A fixed `Clock`. | Vitest: remaining prechecks, date helpers, the API error mapping |
| Integration | `@SpringBootTest` with Testcontainers PostgreSQL 18, MockMvc and `spring-security-test` (`oidcLogin()`) | Vitest, React Testing Library and **MSW** (mocked API, typed from OpenAPI) |
| End to end | — | **Playwright** against the Compose stack (api, db, web, mock-oauth2-server) |
| Security | Authorization matrix, ZAP baseline, dependency and image scans, gitleaks | CSP verification in Playwright (no console CSP violations) |

### Backend

- **Booking rules:**
  - The six prototype scenarios.
  - The nine audit PoCs as regression tests.
  - Every limit at its boundary (exactly the max duration passes, one minute more fails).
  - DST dates.
  - Half-open intervals.
- **API integration:** for each endpoint, the happy path, validation errors (400), Problem Details shape, pagination bounds and range caps.
- **Database integration:**
  - Every `CHECK`, the exclusion constraint and unique indexes.
  - FK `RESTRICT` behaviour.
  - Migrations run from empty.
  - `booking_app` cannot `UPDATE` or `DELETE` `audit_log`.
- **Authorization:**
  - A parameterized matrix (`API_DESIGN.md` §3) over all endpoints × actor fixtures.
  - A meta-test that fails if a controller endpoint exists that is not covered by the matrix. It enumerates `RequestMappingHandlerMapping`.
- **Concurrency:**
  - N parallel creates for one slot gives exactly 1 `APPROVED` booking.
  - N parallel approvals of overlapping requests gives exactly 1.
  - Parallel cancel and approve gives a consistent final state.
  - Parallel requests at a quota boundary never exceed the quota.
- **Approval workflow:** approve and reject state machine; re-validation after membership removal, permission downgrade, or room or org archive; past-start refusal; version conflict.
- **Recurring:** expansion (intervals, weekdays, DST), both conflict policies, series approve with partial conflicts, cancel from a date.

### Frontend

- **Component tests:**
  - Booking dialog: org and room switching, permission badges, preview feedback, the submit error from a 409 or 422.
  - Details dialog actions by role.
  - My Bookings tabs.
  - Admin queue with conflict and competition warnings.
  - Permission-aware rendering: admin nav hidden for non-admins, edit and cancel buttons follow `canEdit` and roles. This is UX only, and the tests say so.
- **Calendar interaction:**
  - FullCalendar in jsdom is limited, so unit tests cover our handlers (`handleSelect`, the drop handler calling the API and `revert`).
  - Real drag and drop is tested in Playwright.

### End to end (Playwright)

The mock identity provider lets tests log in as fixture users without real accounts.

| Scenario | Covers |
|---|---|
| Login and logout (session cookie flags, logout invalidates) | Authentication |
| Direct booking appears in the calendar | Create (DIRECT) |
| Request, then admin approves, then the requester sees the notification | Request workflow |
| Admin rejects with a reason, and the requester sees it | Reject |
| Booking for a NONE room is not possible (UI disabled, and the API call is forced via `page.request`, which returns 403) | Unauthorized booking |
| Two browsers book the same slot at once: one wins, the other sees the conflict | Double booking |
| Drag to a new time persists; drag onto a conflict reverts | Reschedule |
| Cancel frees the slot | Cancel |
| Admin creates a room, sets permissions; ORG_ADMIN invites a member, who accepts | Organization and room management |

### Security testing

| Test | How |
|---|---|
| Authentication bypass | Every non-public endpoint without a session returns 401 (matrix meta-test). Forged or expired session cookie returns 401. OIDC `state`/`nonce` are handled by Spring; covered by a login-CSRF test. |
| Horizontal escalation | Matrix: U3 against org A's objects |
| Vertical escalation | Matrix: U1 and U2 against admin endpoints and role changes. A body containing `globalRole` or `requestedById` is rejected or ignored. |
| Object-level authorization | Every `{id}` endpoint is tested with another org's ID, and with a random UUID (same response). |
| Input validation | Oversized fields, control characters, bad colors, bad time zones, `end <= start`, a range above 62 days |
| Session security | Cookie flags asserted, ID rotated on login, invalidated on logout and on user disable |
| CSRF | A POST without the header returns 403 |
| Dependencies | `npm audit`, OWASP Dependency-Check or Trivy (fs and images), gitleaks |
| Dynamic | ZAP baseline (authenticated) against staging, nightly |

### CI pipeline

**Mandatory on every PR (merge blocked if any fails):**

1. Frontend: `eslint`, `tsc -b`, Vitest (unit and component), `vite build`.
2. Backend: compile, unit tests, **integration tests with Testcontainers**, including:
   - the **authorization matrix** and its coverage meta-test
   - the **concurrency tests**
   - the **migration-from-empty** test
3. OpenAPI drift check: the generated TS types are committed and match the backend's spec.
4. `npm audit --omit=dev --audit-level=high` and the backend dependency scan (fail on High or Critical in production dependencies).
5. gitleaks secret scan.
6. Docker image build and Trivy image scan (fail on fixable High or Critical).
7. Playwright **smoke subset**: login, direct booking, request and approve, unauthorized booking, double booking.

**On `main` and nightly:**

- The full Playwright suite.
- ZAP baseline against staging.
- Full dependency scan, including dev dependencies (report only).
- Deploy to staging.

**Release:**

- A tagged build is promoted to production manually: backup, pull, up, smoke check.

---

## 3. First five implementation tasks

Once this plan is approved:

1. **Close section A of the open questions, and start Feide and Google registration.** Meet Velferdstinget about Q-01, Q-04–Q-09 and Q-30. Submit the Feide service registration and ask the relevant institutions for activation. Create a Google OAuth client. *Output:* written decisions appended to `OPEN_QUESTIONS.md`.
2. **Repo hygiene and frontend CI** (audit Phase 0): root `.gitignore`, unstage `.vite/`, Node LTS `engines`, Vitest upgrade, and a GitHub Actions workflow (lint, typecheck, test, build, audit, gitleaks). Add the nine audit PoCs as expected-behaviour tests.
3. **Backend skeleton with authentication:**
   - `backend/` with Spring Boot 4 and Java 25
   - `compose.dev.yml` with PostgreSQL 18 and `mock-oauth2-server`
   - `oauth2Login`, Spring Session JDBC, `csrf.spa()`, deny-by-default
   - `GET /api/v1/me`, Problem Details handler, `Clock` bean
   - Integration tests for 401 without a session, 403 without CSRF, and `/me` after login
4. **Schema `V1` and integrity proof:** Flyway migration with the core tables, the DB roles and the dev seed. Testcontainers tests for every constraint, plus the **parallel double-booking test** (create and approve).
5. **Port `BookingRules` and its tests:** a pure Java rule class mirroring `bookingRules.ts`, extended with duration, horizon, notice, opening hours and quotas. JUnit tests ported from `bookingService.test.ts` and the audit PoCs, with a fixed clock. This becomes the core that Phase 3's `BookingService` builds on.
