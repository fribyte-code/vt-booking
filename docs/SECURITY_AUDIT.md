# Security Audit – Velferdstinget Booking System

| | |
|---|---|
| **Scope** | Entire repository: `velferdstinget-booking/` (React 19 + TypeScript + Vite SPA), root docs, git history, dependencies |
| **Commit / state** | `a101952` plus uncommitted/staged working tree as of 2026-10-13 |
| **Method** | Manual code review against OWASP Top 10 (2021) and OWASP ASVS 4.0.3; `npm audit`; secret scan of working tree and git history; 9 proof-of-concept unit tests run against the real service layer; XSS payload test in headless Chrome against the local dev server |
| **Out of scope** | No backend exists yet; no external infrastructure was tested |

---

## 1. Executive summary

The application is a **frontend-only prototype**. There is no authentication, no server, and all data and rules live in the user's own browser (localStorage). **In its current form it must not be deployed to production or used with real users' data.** That is expected for a prototype and is documented below as two Critical *production blockers* (VULN-01, VULN-02), not as defects in the prototype itself.

Within that trust model, the code is in reasonably good shape:

- **No XSS.** There are no HTML injection sinks in the code, and a live payload test confirmed React renders user input as text (§7).
- **No secrets** in the working tree or git history.
- **No third-party network calls at runtime.** The font is bundled and there are no analytics or CDNs.
- **Booking rules are centralized** in `services/`. Status transitions are enforced, and extra fields sent in a booking request are not stored (no mass assignment).

The audit did find **real business-logic flaws** that would carry straight into the Spring Boot backend if the rules are ported as written:

- **Unlimited booking length and horizon (VULN-03).** One member can lock a room for years.
- **Approval does not re-check permission or membership (VULN-04).**
- **No quotas or rate limits on requests (VULN-05).**
- **Check-then-insert race (RISK-01).** Concurrent requests to the future API can double-book a room.

**Dependencies:** production dependencies are clean (`npm audit --omit=dev`: 0). The dev-only test runner **Vitest 3.2.7** carries advisories rated Critical (tinypool) and Moderate (@vitest/mocker); see DEP-01.

### Findings by severity

| Severity | Count | IDs |
|---|---|---|
| Critical | 2 | VULN-01, VULN-02 (production blockers, expected in prototype) |
| High | 2 | RISK-01, RISK-02 |
| Medium | 6 | VULN-03, VULN-04, VULN-05, RISK-03, RISK-04, DEP-01 |
| Low | 7 | VULN-06, VULN-07, VULN-08, RISK-05, RISK-06, HYG-01, HYG-02 |
| Info | 1 | HYG-03 |

**How to read the IDs:**
- **VULN-**: verified in the current code.
- **RISK-**: a design issue that becomes exploitable once a backend exists.
- **DEP-**: a dependency issue.
- **HYG-**: repository hygiene.

The **Prototype** column in each table says whether the issue can be exploited in the current build.

---

## 2. Architecture and trust model (as reviewed)

```
Browser
 ├─ React UI (components/, pages/)
 ├─ AppProvider (context/AppProvider.tsx) ── current user id from localStorage
 └─ bookingService (services/bookingService.ts)
      ├─ bookingRules.ts (permissions, overlap, validation)
      └─ localStorage key "vt-booking:data:v1" (users, orgs, rooms, bookings)
```

- **Identity.** The "logged-in" user is an ID read from `localStorage["vt-booking:current-user"]` and chosen freely in the UI user switcher (`context/AppProvider.tsx:35`, `:74`, `:86-88`; `components/layout/UserSwitcher.tsx:66`).
- **Authorization.** Checks run in `services/bookingService.ts` (`requireAdmin` at `:68-74`, owner check at `:168`) and in `services/bookingRules.ts:56-110`. All of them execute in the browser, on data the browser controls.
- **Admin UI.** Access is gated purely by the client-side checks at `pages/AdminPage.tsx:22` and `components/layout/Sidebar.tsx:57`.

Every finding below should be read with this model in mind: **today the attacker and the victim are the same browser.** The real risk lies in carrying these patterns into the production backend.

---

## 3. Confirmed vulnerabilities

### VULN-01 — No authentication: identity is chosen by the client
| Severity | Prototype | Production |
|---|---|---|
| **Critical** (blocker) | Exploitable by design: anyone can become the admin | Blocker until replaced |

- **Where:** `velferdstinget-booking/src/context/AppProvider.tsx:35, 74, 86-88`; `src/components/layout/UserSwitcher.tsx:66-97`; `src/data/mockData.ts:10-21`.
- **How:** the current user is whatever ID is stored in localStorage or picked in the switcher. Choosing "Silje Aas" grants full administrator rights. Users have no credentials at all.
- **OWASP:** A07 Identification and Authentication Failures; ASVS V2, V3.
- **Fix:**
  - Implement authentication in Spring Security with OIDC (Feide or the organization's Google Workspace). Avoid local passwords.
  - The SPA must never send or choose the user's identity.
  - Use a server-side session with an `HttpOnly; Secure; SameSite=Lax` cookie, or the BFF pattern. Avoid putting tokens in localStorage.
  - Delete the user switcher and the `USER_KEY` logic before production.

### VULN-02 — All authorization and data live in the client
| Severity | Prototype | Production |
|---|---|---|
| **Critical** (blocker) | Exploitable (self-only): confirmed by PoC | Blocker |

- **Where:**
  - `src/services/bookingService.ts:44-58` (load and save the whole data set from localStorage), `:68-74`, `:168`
  - `src/services/bookingRules.ts:56-110`
  - `src/pages/AdminPage.tsx:22`
- **How:**
  - All permission checks run in the browser on data that DevTools can edit.
  - **PoC (F-01):** I set `role: 'ADMIN'` on user Ola in stored data. Ola could then approve his own pending request (`decidedById: 'user-ola'`).
  - Anyone can also rewrite `rooms[].permissions` to grant their organization `DIRECT` access, or set a booking's `status` directly.
- **OWASP:** A01 Broken Access Control; A04 Insecure Design; ASVS V4.1.1 ("access control rules are enforced on a trusted service layer").
- **Fix:**
  - Port `bookingRules.ts` to the backend and enforce it there on every request.
  - Treat frontend checks as UX only; the code comments already say this.
  - PostgreSQL becomes the single source of truth, and localStorage must hold no domain data in production.

### VULN-03 — Unbounded booking duration and booking horizon (room hoarding)
| Severity | Prototype | Production |
|---|---|---|
| **Medium** | Exploitable: confirmed by PoC | Exploitable if the rules are ported as-is |

- **Where:** `src/services/bookingRules.ts:56-110` (`evaluateBooking` only checks `end > start` and `start >= now`).
- **How:**
  - **PoC (F-03):** Kari (Org A, DIRECT on Møterom A) booked Møterom A from 1 Jan 2027 to 31 Dec 2031 (1,826 days). It was confirmed instantly.
  - A later booking attempt by Org B in 2029 was rejected with `CONFLICT`.
  - Any single member of an organization with DIRECT access can therefore deny the room to everyone for years.
- **OWASP:** A04 Insecure Design (business-logic abuse); ASVS V11.1 (business logic limits).
- **Fix:**
  - Enforce server-side limits per room or organization: maximum duration (e.g. 12 h), maximum horizon (e.g. 6 months ahead), and optionally opening hours.
  - Make limits configurable on `rooms`.
  - Add the same checks to `evaluateBooking` so the UI explains them.

### VULN-04 — Approval does not re-check permission or membership
| Severity | Prototype | Production |
|---|---|---|
| **Medium** | Exploitable: confirmed by PoC | Exploitable if ported |

- **Where:** `src/services/bookingService.ts:118-143` (`approveBooking` checks only admin role, `PENDING` status, start time and conflicts).
- **How:**
  - **PoC (F-06):** a request was created by Org A. The admin then set Org A's Storsalen permission to `NONE` and removed the requester from Org A.
  - Approving the old request still succeeded (`APPROVED`).
  - Revoked access is therefore not effective for requests already in the queue. A removed or offboarded member's request can still become a confirmed booking.
- **OWASP:** A01 Broken Access Control (stale authorization).
- **Fix:**
  - In `approve`, re-check inside the same transaction that the requester is still a member of the organization and that the organization's permission is still `REQUEST` or `DIRECT`.
  - When an organization's access is downgraded to `NONE`, or a membership is removed, automatically reject (or flag) that organization's or member's pending requests.

### VULN-05 — No quotas or rate limiting on bookings and requests
| Severity | Prototype | Production |
|---|---|---|
| **Medium** | Exploitable: confirmed by PoC | Exploitable if ported |

- **Where:** `src/services/bookingService.ts:93-116`; `src/services/bookingRules.ts:56-110`.
- **How:**
  - **PoC (F-05):** a single user created 500 pending requests for the same Storsalen slot. All were accepted, flooding the admin queue (`pages/AdminPage.tsx`).
  - DIRECT bookings are also unlimited (compounds VULN-03).
- **OWASP:** A04 Insecure Design; ASVS V11.1.4 (anti-automation).
- **Fix:**
  - Per-user and per-organization limits on open pending requests (e.g. ≤ 10) and on future bookings.
  - Reject duplicate requests (same user, room and time range).
  - Add API rate limiting, for example Bucket4j in Spring or `limit_req` in Nginx.

### VULN-06 — Text length and content limits exist only in the UI
| Severity | Prototype | Production |
|---|---|---|
| **Low** (Medium for production) | Exploitable (self-only): confirmed by PoC | Storage/DoS vector if ported |

- **Where:**
  - UI-only `maxLength`: `src/components/booking/BookingDialog.tsx:132` (title 80), `:222` (description 500); `src/components/booking/RejectDialog.tsx:51` (comment 300).
  - The service stores the strings unbounded: `src/services/bookingService.ts:104-106`, `:156`.
- **How:** **PoC (F-04):** a 1,000,000-character title and description were accepted and persisted (~2 MB). In a shared backend this means storage abuse, oversized responses for every calendar viewer, and admin UI degradation.
- **OWASP:** A04; ASVS V5.1.3/V5.1.4 (input validation on a trusted layer).
- **Fix:**
  - Use Bean Validation on DTOs (`@NotBlank @Size(max=80)` for title, `@Size(max=500)` for description and comment).
  - Add matching `varchar(n)` / `CHECK` constraints in PostgreSQL.
  - Cap the request body size in Spring and Nginx (`client_max_body_size`).
  - Strip control characters.

### VULN-07 — Former members can still cancel bookings made for an organization
| Severity | Prototype | Production |
|---|---|---|
| **Low** | Exploitable: confirmed by PoC | Exploitable if ported |

- **Where:** `src/services/bookingService.ts:163-184` (the owner check at `:168` uses `requestedById` only).
- **How:** **PoC (F-07):** after Kari was removed from Org A, she could still cancel Org A's confirmed booking that she had created. A departed member can therefore sabotage the organization's events.
- **Fix:** Require current membership of `booking.organizationId` (or admin role) to cancel. Optionally let organization admins cancel on behalf of the organization.

### VULN-08 — Persisted data is trusted without schema validation
| Severity | Prototype | Production |
|---|---|---|
| **Low** | Self-DoS only: confirmed by PoC | N/A once localStorage is removed, but the principle applies to API responses |

- **Where:** `src/services/bookingService.ts:44-58` (`JSON.parse(raw) as DemoData`); `src/context/AppProvider.tsx:11-18` (`readPref`).
- **How:** **PoC (F-08):** stored JSON that parses but has the wrong shape is returned as-is. `bookings` comes back `undefined`, the next write throws `TypeError`, and the UI fails to render. Only the local user is affected.
- **Fix:**
  - Validate the shape of persisted data and API responses at the boundary (e.g. zod), falling back to a reset if it is invalid.
  - In production, validate every API request DTO server-side (Bean Validation).

---

## 4. Potential security risks (future production)

These cannot be exploited today, but the current design would create them in the planned Spring Boot/PostgreSQL system if it is ported without changes.

### RISK-01 — Check-then-insert race allows double booking
| Severity | Prototype | Production |
|---|---|---|
| **High** | Not exploitable (single-threaded, one browser) | Exploitable under concurrency |

- **Where:** `src/services/bookingService.ts:93-116` (`evaluateBooking` at `:96`, then `push` and `save` at `:113-114`); `:118-143` (conflict check at `:127`, then update at `:136`).
- **How:**
  - On a multi-threaded server, two simultaneous `POST /api/bookings` requests for the same room and time can both pass `findConflicts` before either inserts.
  - The same applies when two admins approve two overlapping pending requests at the same time. The README explicitly invites competing pending requests.
  - Result: two `APPROVED` bookings for one room and time slot, which breaks the core business rule.
- **OWASP:** A04 Insecure Design; ASVS V11.1.6 (atomic business logic).
- **Fix:** enforce non-overlap in the database, not only in Java.
  ```sql
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (room_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
    WHERE (status = 'APPROVED');
  ```
  - Map the resulting `23P01` exclusion-violation error to HTTP `409 Conflict`.
  - Add a `CHECK (end_at > start_at)` constraint.
  - Use optimistic locking (`@Version`) on status transitions, so a concurrent cancel and approve cannot both succeed.

### RISK-02 — `actorId` passed as a parameter: impersonation if ported literally
| Severity | Prototype | Production |
|---|---|---|
| **High** | N/A | Exploitable if the API accepts the actor from the request |

- **Where:** `src/services/bookingService.ts:93, 118, 146, 163, 187` (every mutation takes `actorId` or `userId` as an argument); `src/context/AppProvider.tsx:97-101`.
- **How:**
  - The comment at `bookingService.ts:17` says the backend will take the actor from the session. But it would be easy to translate the signatures into `POST /api/bookings/{id}/approve { "actorId": "user-admin" }` or `?userId=`.
  - That would let any client act as any user, including the admin (BOLA/impersonation).
- **OWASP:** A01 Broken Access Control; ASVS V4.2.1.
- **Fix:**
  - API endpoints must never accept the acting user's identity from the client. Derive it from `SecurityContextHolder` / `@AuthenticationPrincipal`.
  - Remove `actorId` from the TypeScript service signatures when wiring up `fetch`.
  - Add tests asserting that a body/query `userId` is ignored.

### RISK-03 — Over-broad data exposure (PII and other organizations' bookings)
| Severity | Prototype | Production |
|---|---|---|
| **Medium** | Visible to anyone (mock data only) | Personal-data leak and GDPR exposure |

- **Where:**
  - `src/services/bookingService.ts:10, 89-91`: the planned mapping `getData → GET /api/users, /api/bookings` returns every user (name, **email**, memberships) and every booking to every client.
  - `src/pages/CalendarPage.tsx:39`: every user sees all organizations' pending request titles and descriptions.
  - `src/pages/AdminPage.tsx:234-239`: renders emails, which is acceptable for admins only.
- **How:** if the production API mirrors `getData`, every authenticated student can download the full user directory with emails, plus other organizations' booking details (`description` is free text and may contain personal data).
- **OWASP:** A01 / A04; ASVS V8.3 (sensitive private data), V4.2.
- **Fix:**
  - Design the endpoints per role:
    - `GET /api/calendar?from&to&rooms` returns a minimal projection (room, time, status, organization name, title), with descriptions and requester only for one's own organization or for admins.
    - `GET /api/users` is admin-only.
    - `/api/me` covers one's own profile.
  - Decide and document who may see pending requests from other organizations (listed as an open question in the root README).
  - Make a GDPR record of processing and a retention policy (e.g. delete or anonymize bookings after N months).

### RISK-04 — Predictable identifiers; object-level authorization required on every endpoint
| Severity | Prototype | Production |
|---|---|---|
| **Medium** | N/A | IDOR/BOLA if any endpoint lacks an ownership check |

- **Where:** `src/services/bookingService.ts:39-41` (`Date.now()` + `Math.random()` IDs); seed IDs such as `bk-seed-1`, `user-admin`, `org-a` (`src/data/mockData.ts`).
- **How:** booking and user IDs are guessable. Any future endpoint like `GET /api/bookings/{id}`, `/cancel` or `/reject` that does not re-check ownership, membership or admin role would expose or modify others' data.
- **Fix:**
  - Use database-generated UUIDs.
  - More importantly, enforce object-level authorization in every handler, never relying on unguessable IDs (e.g. a `BookingAuthorizationService` used by every endpoint, or Spring `@PreAuthorize` with a custom permission evaluator).
  - Add negative tests for each endpoint ("user from Org B cannot cancel or view Org A's booking").

### RISK-05 — Time is taken from the client clock and time zone
| Severity | Prototype | Production |
|---|---|---|
| **Low** | Self-only | Logic errors and bypassed time rules if trusted |

- **Where:** `src/lib/dates.ts:16-20` (`new Date(\`${date}T${time}\`)` uses the browser's time zone); `src/services/bookingRules.ts:74` and `bookingService.ts:124, 174` use `now()` from the client.
- **How:**
  - A user with a skewed clock or a different time zone creates bookings at unintended times. In production, client-supplied "now" must never be trusted for the "no past bookings" and "cannot cancel started bookings" rules.
  - DST transitions in `Europe/Oslo` (e.g. 02:00–03:00 on the last Sunday of March) can yield nonexistent or ambiguous local times.
- **Fix:**
  - The server uses its own clock (`Clock` bean) and stores `timestamptz`.
  - Define business time explicitly as `Europe/Oslo`.
  - Accept ISO-8601 with an offset from the client and reject nonexistent local times.

### RISK-06 — Unvalidated CSS values (room colour) from data
| Severity | Prototype | Production |
|---|---|---|
| **Low** | Not exploitable (tested) | Low, if admins can edit rooms |

- **Where:** `src/components/calendar/BookingCalendar.tsx:70, 127`; `src/components/booking/badges.tsx:36`; `src/components/layout/Sidebar.tsx:79`; `src/components/booking/BookingListItem.tsx:33`; `src/lib/color.ts:2-7`.
- **How:** `room.color` is written into inline styles and CSS variables. I injected `red;background:url(https://example.invalid/x)` into storage. React and `style.setProperty` treated it as one invalid value, so nothing was injected. Because it is unvalidated, though, a future room-editing UI could store unexpected values.
- **Fix:** validate `color` server-side against `^#[0-9a-fA-F]{6}$` (DB `CHECK`), and validate it in the room admin form.

---

## 5. Missing production security controls

The table maps controls that do not exist yet to OWASP Top 10 / ASVS. All of them are **blockers** unless marked otherwise.

| # | Control | OWASP / ASVS | Notes |
|---|---|---|---|
| C-1 | Authentication via OIDC (Feide / Google Workspace) in Spring Security | A07 · V2, V3 | Replaces VULN-01. No local passwords. |
| C-2 | Server-side session (`HttpOnly`, `Secure`, `SameSite=Lax`), idle and absolute timeout, logout that invalidates the session | V3 | Do not store access tokens in localStorage. Prefer the BFF pattern. |
| C-3 | CSRF protection for cookie-based sessions (Spring Security CSRF with the `XSRF-TOKEN` cookie → header) | A01 · V4.2.2 | Needed because the SPA uses cookies. |
| C-4 | Server-side authorization: role (USER/ADMIN), membership, `room_access`, object ownership; deny by default | A01 · V4 | Port `bookingRules.ts`; see VULN-02, VULN-04, VULN-07, RISK-02, RISK-04. |
| C-5 | DB constraints: exclusion constraint, `CHECK(end_at > start_at)`, enum `CHECK` on status, FKs, `varchar` limits | A04 · V11 | RISK-01, VULN-06. |
| C-6 | Input validation (Bean Validation) on all DTOs; body size limits | A03 · V5 | VULN-06. JPA/parameterized queries only: no string-concatenated SQL or JPQL. |
| C-7 | Business limits: max duration, max horizon, quotas, duplicate-request detection | A04 · V11.1 | VULN-03, VULN-05. |
| C-8 | Rate limiting (Nginx `limit_req` + application level) | A04 · V11.1.4 | Login, booking creation, approvals. |
| C-9 | Security headers from Nginx: strict CSP (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` | A05 · V14.4 | `index.html` has no CSP today. FullCalendar and React inline styles need `style-src 'unsafe-inline'`. Verify before enforcing. |
| C-10 | TLS everywhere (Let's Encrypt or institutional certificate), HTTP→HTTPS redirect, TLS 1.2+ | A02 · V9 | |
| C-11 | Same-origin deployment (Nginx proxies `/api` to Spring) to avoid CORS; if CORS is needed, use an explicit allowlist and never `*` with credentials | A05 · V14.5 | |
| C-12 | Audit log of security-relevant events: login, booking created, approved, rejected, cancelled, permission and membership changes (who, what, when) | A09 · V7 | Approval decisions especially need accountability. |
| C-13 | Error handling: generic messages to clients, no stack traces (`server.error.include-stacktrace=never`), structured server logs without personal data in clear text | A05/A09 · V7.4 | The frontend already hides non-domain errors (`src/lib/errors.ts:3-5`). |
| C-14 | Secrets management: DB credentials and OIDC client secret via Docker secrets or env files outside git; separate least-privilege DB user (no superuser, no DDL at runtime except migrations) | A05 · V6.4, V14.1 | |
| C-15 | Docker hardening: non-root containers, read-only FS where possible, PostgreSQL not published to the host or network (internal Docker network only), pinned image digests, regular image updates | A05 | Root README already says "the database is only reachable from the backend". |
| C-16 | Backups (encrypted, tested restore) and data retention / GDPR deletion routines | V8 | |
| C-17 | Dependency and container scanning in CI (`npm audit`, OWASP Dependency-Check or Gradle/Maven equivalent, Trivy), plus Dependabot/Renovate | A06 · V14.2 | See DEP-01. |
| C-18 | Security test suite: authorization matrix tests per endpoint (user × org × room × action), concurrency test for double booking | V1.1 | Extend the existing Vitest suite and add backend integration tests (Testcontainers). |
| C-19 | Admin hardening: admin role assigned server-side only; consider MFA (provided by Feide/Google) and a separate admin audit view | A07 | |
| C-20 | Remove prototype features before go-live: user switcher, "Tilbakestill demodata", mock data, `vt-booking:*` localStorage domain data | A05 | |

---

## 6. Dependency vulnerabilities

`npm audit` on 2026-10-13, Node v23.11.0:

| Package | Installed | Advisory | Advisory severity | Type | Effective risk |
|---|---|---|---|---|---|
| `tinypool` (via `vitest`) | ≤ 2.1.1 | GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr (prototype-pollution gadget → RCE in worker options) | Critical | dev | **Medium** |
| `@vitest/mocker` (via `vitest`) | 3.2.7 | GHSA-82fw-gwwq-j7x9 (path traversal / arbitrary file read via redirect mock) | Moderate (CVSS 5.9) | dev | **Low** |
| `vitest` | 3.2.7 | depends on the above | Critical (inherited) | dev, direct | — |

- `npm audit --omit=dev` reports **0 vulnerabilities**. None of these packages are in the production bundle, which ships only static JS/CSS built by Vite.

### DEP-01 — Vulnerable test runner (dev dependency)
- **Severity:** Medium (effective).
- **Why not Critical:** exploitation requires attacker-controlled input to reach Vitest's worker or mock options, or a separate prototype-pollution primitive, on a developer machine or CI runner. These run only during `npm test`.
- **Why it still matters:** CI runners often hold secrets.
- **Where:** `velferdstinget-booking/package.json` (devDependencies `vitest ^3.2.7`), `package-lock.json`.
- **Fix:** upgrade to a patched major, **`vitest@^4.1.11` or `^5.0.4`**. **Do not** run `npm audit fix --force`: it proposes a *downgrade* to `vitest@2.0.5`. Re-run `npm test` after upgrading.

### Other dependency observations

- **Outdated majors, no known vulnerabilities:** `@fullcalendar/*` 6.1.21 (7.x exists), `typescript` 6.0.3 (7.x), `@types/node` 24 (26). FullCalendar is intentionally pinned to v6, because the v7 React adapter pulls in an incompatible core (see `CLAUDE.md`). Track v6 security releases.
- **Risky install patterns:** none found. No `postinstall` scripts from direct dependencies were reviewed as risky, and the lockfile is committed.

---

## 7. Positive findings (verified)

| Area | Result | Evidence |
|---|---|---|
| XSS | **Not exploitable.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`, dynamic `href` or `window.open` anywhere in `src/`. FullCalendar events render through React (`eventContent`). | `grep` over `src/`. **Live test:** the payload `<img src=x onerror=…><script>…</script><svg onload=…>` was submitted as title and description, and also written directly into storage as room and organization names. It rendered as text in the week view, month view, details dialog, My Bookings and Admin. Script executions: 0; injected elements: 0; dialogs: 0. |
| Injection (SQL/command) | No server, no query construction. | — |
| Mass assignment | Extra fields (`status`, `requestedById`, `decidedById`) in the create input are ignored. The service copies only allow-listed fields. | `bookingService.ts:101-112`; PoC "positive" test. |
| Status machine | Approve and reject only from `PENDING`; cancel only `APPROVED`/`PENDING` and only before start; non-admins cannot approve or reject; non-owners cannot cancel. | `bookingService.ts:76-80, 118-184`; existing tests + PoC. |
| Overlap logic | Half-open intervals; only `APPROVED` bookings block; approval re-checks conflicts. | `bookingRules.ts:37-54`; `bookingService.ts:127-134`; tests. |
| Error disclosure | The UI shows only domain messages; unknown errors show a generic text. | `src/lib/errors.ts:3-5`. |
| Secrets | None in the working tree or git history (pattern scan for keys, tokens, private keys, AWS/GitHub/OpenAI-style tokens; sensitive filenames). Mock users use `example.no` addresses. | Scan output: no matches. |
| Third-party runtime calls | None. The Inter font is bundled (`@fontsource-variable/inter`); no CDN, analytics or trackers. | `main.tsx`, `index.css`. |
| Dev server exposure | Vite binds to `localhost` only (no `server.host`). | `vite.config.ts`. |
| Tests | 6/6 existing tests pass. 9/9 audit PoC tests behave as documented above. | `npm test`. |

---

## 8. Repository hygiene

| ID | Severity | Finding | Fix |
|---|---|---|---|
| HYG-01 | Low | `velferdstinget-booking/.gitignore` ignores `*.local` but not `.env`, `.env.*`, `*.pem` or `*.key`, and the repo root has no `.gitignore`. Once the backend arrives, `.env` files with DB passwords or OIDC secrets can easily be committed by mistake. | Add a root `.gitignore` with `.env`, `.env.*`, `!.env.example`, `*.pem`, `*.key`, `.vite/`, `node_modules/`, `dist/`. Consider a pre-commit secret scanner (gitleaks). |
| HYG-02 | Low | The local Node is v23.11.0, an odd-numbered release that is end-of-life. `package.json` has no `engines` field. | Build and run CI on an active LTS release and add `"engines": { "node": ">=24" }` (or the chosen LTS). Pin the Node image in Docker builds. |
| HYG-03 | Info | A Vite cache (`.vite/deps/_metadata.json`, `.vite/deps/package.json`) is **staged** in git (`AD` state). It is not sensitive, but it is build output. | `git rm -r --cached .vite` before committing; covered by HYG-01. |

---

## 9. Prioritized remediation roadmap

### Phase 0 — Now (prototype, low effort)
1. **DEP-01:** upgrade Vitest to ≥ 4.1.11 or 5.0.4. Do not use `audit fix --force`.
2. **HYG-01/03:** add a root `.gitignore` and unstage `.vite/`.
3. **VULN-03, VULN-04, VULN-05, VULN-06, VULN-07:** add the missing rules to `bookingRules.ts`/`bookingService.ts`, so the backend can port a complete, tested rule set:
   - maximum duration and horizon
   - re-validation on approval
   - quotas and duplicate detection
   - length limits
   - membership-based cancellation
4. Add regression tests mirroring the PoCs in this report.

### Phase 1 — Backend foundation (before any real user data)
5. **C-1, C-2, C-3, C-19:** Spring Security with OIDC, server session, CSRF, server-assigned roles.
6. **C-4, RISK-02, RISK-04:** authorization service with deny-by-default and object-level checks; identity only from the session; authorization matrix tests.
7. **C-5, RISK-01:** PostgreSQL schema with the exclusion constraint, CHECKs, FKs, `@Version`, Flyway migrations; concurrency test.
8. **C-6, C-7:** Bean Validation and business limits server-side.
9. **RISK-03:** role-scoped API projections; admin-only user directory; decide pending-request visibility.

### Phase 2 — Deployment hardening (before go-live)
10. **C-9, C-10, C-11:** Nginx with TLS, HSTS, CSP and other headers; same-origin `/api` proxy.
11. **C-14, C-15:** secrets outside git, least-privilege DB user, non-root containers, DB on an internal network only.
12. **C-12, C-13:** audit logging, safe error handling, log hygiene.
13. **C-8:** rate limiting.
14. **C-20:** remove the user switcher, demo reset and mock data.

### Phase 3 — Operations
15. **C-16:** backups with restore tests; retention and GDPR routines.
16. **C-17:** dependency and container scanning in CI; Renovate/Dependabot.
17. A periodic review or penetration test of the deployed system before each major release.

---

## 10. Production readiness checklist

**Identity and access**
- [ ] OIDC login (Feide / Google Workspace); no local passwords; the user switcher is removed
- [ ] Session cookie `HttpOnly` + `Secure` + `SameSite`; timeouts; server-side logout
- [ ] CSRF protection enabled for state-changing requests
- [ ] Roles and memberships managed server-side only; admin MFA via the IdP
- [ ] Every endpoint derives the actor from the session; no `userId`/`actorId` accepted from the client
- [ ] Object-level authorization on every booking, user, organization and room endpoint; deny by default
- [ ] An authorization matrix test suite passes (user × org × room × action)

**Booking integrity**
- [ ] PostgreSQL exclusion constraint prevents overlapping `APPROVED` bookings; `409` mapping
- [ ] `CHECK (end_at > start_at)`, status enum check, FKs, text length limits
- [ ] Optimistic locking on status transitions
- [ ] Approval re-checks availability, membership and room permission in one transaction
- [ ] Max duration, max horizon, request quotas and duplicate detection enforced server-side
- [ ] Cancellation requires current membership (or admin)
- [ ] Server clock and `Europe/Oslo` business time; `timestamptz` storage
- [ ] Concurrency test: N parallel bookings or approvals for one slot leaves exactly 1 `APPROVED`

**Data protection**
- [ ] API returns role-scoped projections; user directory and emails are admin-only
- [ ] Visibility of other organizations' pending requests decided and implemented
- [ ] GDPR: record of processing, retention and deletion job, privacy notice
- [ ] Encrypted, tested backups

**Platform**
- [ ] TLS with HSTS; HTTP→HTTPS redirect
- [ ] CSP and security headers from Nginx (verified with FullCalendar inline styles)
- [ ] Same-origin `/api` proxy, or a strict CORS allowlist
- [ ] Containers run as non-root; DB not exposed outside the Docker network; least-privilege DB user
- [ ] Secrets via Docker secrets or env files outside git; `.gitignore` covers `.env*`, keys and certs
- [ ] Rate limiting at Nginx and the application
- [ ] Audit log for approve, reject, cancel and permission/membership changes
- [ ] Generic error responses; no stack traces; logs free of sensitive data

**Supply chain and process**
- [ ] `npm audit` (prod and dev) is clean, or risk-accepted with justification; Vitest upgraded
- [ ] Backend dependency scanning, container image scanning, Renovate/Dependabot
- [ ] Node LTS pinned (`engines`, Docker base image)
- [ ] Prototype artifacts removed (mock data, demo reset, localStorage domain data)
- [ ] A security review or penetration test of the deployed staging environment is completed

---

## Appendix A — Proof-of-concept tests

The PoCs were run from a scratch directory outside the repository (`audit.test.ts`), importing the real `src/services/bookingService.ts` with an in-memory store and a fixed clock. **No application code was modified.**

| PoC | Finding | Observed result |
|---|---|---|
| F-01 | VULN-02 | Tampered `role: 'ADMIN'` → self-approval succeeded (`decidedById: user-ola`) |
| F-03 | VULN-03 | 1,826-day DIRECT booking → `APPROVED`; other organization blocked with `CONFLICT` |
| F-04 | VULN-06 | 1,000,000-character title stored (~2 MB in storage) |
| F-05 | VULN-05 | 500 pending requests accepted (505 total pending) |
| F-06 | VULN-04 | Approval succeeded after permission → `NONE` and membership removed |
| F-07 | VULN-07 | Ex-member cancelled the organization's booking |
| F-08 | VULN-08 | Malformed storage returned unvalidated; the next write threw `TypeError` |
| +2 | Positive | Mass assignment ignored; REQUEST cannot self-approve; non-owner cannot cancel or reject |
| XSS | §7 | Headless Chrome against the local dev server: 0 executions, 0 injected elements |
