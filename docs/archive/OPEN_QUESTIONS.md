# Open Questions

These are decisions that need confirmation from Velferdstinget Vest. Each one has a proposed default, so planning and most of the implementation can continue.

**Status:** prepared 2026-10-13 for review.

**Mapping to the README's "Må avklares med Velferdstinget" list:**

| README question | Here |
|---|---|
| 1. Replace Google Calendar entirely? | Q-02 |
| 2. Multiple organizations per user? | Already decided **yes** (REQ) |
| 3. Some orgs direct, others request? | Already decided **yes** (DIRECT/REQUEST/NONE) |
| 4. Pending requests reserve the slot? | Q-03 |
| 5. Who sees which rooms and bookings? | Q-05, Q-06 |
| 6. Organizations with their own admins? | Q-04 |
| 7. Limits on duration and number of bookings? | Q-10 |

**How to read each entry:**

- **Default:** what we will build if no other answer arrives.
- **Consequence:** what the default means in practice, and how expensive it is to change later.

---

## A. Must decide before implementation

These affect identity, data protection, or foundations that are expensive to change. Q-04, Q-07, Q-21 and Q-24 are decided; Q-30 is withdrawn. They block Phase 1–2 work (see `DEVELOPMENT_PLAN.md`).

### Q-01 Backend technology and long-term maintainers

- **Question:** Who maintains the system after the initial development? What do they know: Java or Python?
- **Default:** Spring Boot (`ARCHITECTURE.md` §3).
- **Consequence:**
  - The backend language is the most expensive decision to reverse.
  - If the realistic maintainers after handover are Python-only, choose FastAPI, with the mandatory compensations listed in `ARCHITECTURE.md` §3.
  - Decide before Phase 1 starts.

### Q-07 Login providers and who may log in — **DECIDED 2026-10-13**

- **Decision:**
  - Email and password is the primary login. Optional Google account linking later. **No Feide.**
  - **Invite-only.** Accounts are created only through the one-time CLI bootstrap (first `SYSTEM_ADMIN`) or an administrator invitation. No self-registration, no account creation on first external login.
- **Consequence:**
  - We own password hashing, reset and brute-force protection (`ARCHITECTURE.md` §4). SMTP is now required for the pilot (Q-17).
  - Only invited users can see the calendar.

### Q-30 Feide service registration — **WITHDRAWN 2026-10-13**

Feide is not used (Q-07). No registration or institution activation is needed.

### Q-04 Organization administrators — **DECIDED 2026-10-13**

- **Decision:** **Yes.**
  - ORG_ADMINs invite members, appoint and remove other ORG_ADMINs, and remove members, in their own organization only.
  - `SYSTEM_ADMIN`s have full access: rooms, organizations, users, global roles, permissions and all bookings.
  - **Only `SYSTEM_ADMIN` approves or rejects booking requests** for now.
- **Consequence:**
  - ORG_ADMINs **cannot** change room permissions, approve requests, or change a user's email, status or password.
  - Delegating approval later (Q-19) is an authorization change, not a schema change.

### Q-05 Calendar visibility

- **Question:** What can a logged-in user see about *other* organizations' confirmed bookings?
- **Default:** Time, room, title and organization name. Not the description or the person who booked.
- **Alternatives:**
  1. "Opptatt" only, with no title or organization.
  2. Public (unauthenticated) calendar.
- **Consequence:**
  - The default resembles today's shared Google calendars.
  - Option 1 is a projection change: cheap.
  - Option 2 means we'd also need a public read-only endpoint and rate limits. Doable later.
  - Titles may contain personal data. Users are told that titles are visible to all logged-in users.

### Q-06 Visibility of pending requests

- **Question:** Should other organizations see pending requests in the calendar? The prototype shows them to everyone.
- **Default:** **No.** Pending requests are visible only to the requesting organization's members and to admins. Others see nothing until a request is approved.
- **Consequence:**
  - Less information leak. The calendar shows actual occupancy only.
  - Organizations can't see that someone else has applied for the same slot. The admin queue still shows competing requests.

### Q-08 Data controller, privacy notice and data processing agreement

- **Question:** Is Velferdstinget Vest the data controller? Who signs the data processing agreement with the hosting provider? Who writes and approves the privacy notice ("personvernerklæring")?
- **Default:**
  - Velferdstinget is the controller.
  - We provide a draft record of processing and a privacy notice text in Phase 4.
- **Consequence:** This is a GDPR prerequisite for going live with real users. It doesn't block development.

### Q-09 Hosting location, domain and existing infrastructure

- **Question:** Where will it run (the README mentions fribyte)? What is the hostname? Is there an existing reverse proxy, TLS setup, mail relay, backup target or monitoring we should use?
- **Default:** A single VM with Docker Compose. Our own Nginx with Let's Encrypt. Backups to a separate machine via restic.
- **Consequence:**
  - The hostname is needed for invitation and reset links in emails, the Google OIDC redirect URI (if linking is enabled), and ICS URLs, which are hard to change once users subscribe.
  - The existing infrastructure decides whether `web` terminates TLS itself.

---

## B. Can use provisional defaults

We will build these defaults. Each is a configuration value or a small, contained change if the answer differs.

### Q-03 Do pending requests reserve the time slot?

- **Default:** **No** (the current prototype behaviour). Several requests may overlap, and only one can be approved. A request for an already-confirmed slot is refused at submission.
- **Consequence:**
  - Fair to all applicants. The admin chooses between them.
  - Switching to "pending reserves" later is one constraint migration (`DATABASE_DESIGN.md` §5), plus a decision about how long a pending request may hold a slot.

### Q-10 Booking limit values

Defaults, all configurable globally and per room or organization:

| Limit | Default |
|---|---|
| Max duration | 12 hours |
| Max advance window | 180 days |
| Max pending requests per user | 10 |
| Max pending requests per org | 25 |
| Max future bookings per org | 50 |
| Minimum notice | 0 minutes |

**Consequence:** These close audit findings VULN-03 and VULN-05. The numbers are guesses. Adjust them from pilot data.

### Q-11 May bookings cross midnight?

- **Default:** **No** (prototype rule). An end time of 00:00 means end of day.
- **Consequence:**
  - Events that run past midnight (parties, overnight events) can't be booked as one booking.
  - If they're needed, we allow crossing midnight within opening hours and the max duration. It is a rule change only; the schema already supports it.

### Q-12 Recurring bookings

- **Default:**
  - Weekly or every 2–4 weeks, on chosen weekdays.
  - A required end date, at most 180 days ahead and 30 occurrences.
  - A whole series counts as **one** booking towards the org quota.
  - A REQUEST-permission series is approved as a whole, but conflicting occurrences are skipped and reported.
- **Consequence:**
  - Organizations re-create standing meetings each semester.
  - Monthly patterns ("first Tuesday") aren't supported.

### Q-13 Fixed reservations ("faste tider")

- **Default:**
  - Admins create **fixed reservations** as approved recurring bookings on behalf of an organization.
  - Admins create **blocks** (maintenance, closures) that occupy the room.
  - Both use the normal conflict rules.
- **Postponed:** priority windows (first right to a slot until a deadline) and semester allocation rounds.
- **Consequence:** Covers "org X always has room Y on Mondays". If priority windows are needed, it is a new table and rule (about 1–2 weeks of work).

### Q-14 What happens when access is reduced

- **Default:**
  - Membership removed or expired: that user's pending requests for that org are auto-rejected. Approved bookings stay.
  - Org's room permission set to NONE: pending requests auto-rejected. Future approved bookings **stay**, but appear in an admin review list.
  - Org archived: future bookings cancelled, with notification.
- **Consequence:** The admin decides whether to cancel already-confirmed bookings, which avoids surprising cancellations.

### Q-15 Rescheduling (drag/drop, resize)

- **Default:**
  - DIRECT: the organization may move its own approved bookings within the rules.
  - REQUEST: approved bookings cannot be moved by the user. They cancel and re-apply, or ask an admin.
  - Pending requests can be moved freely.
  - Admins can move anything.
- **Consequence:** No "change request" workflow is needed. If Velferdstinget wants moves of REQUEST-approved bookings to go back to approval, that's a moderate change.

### Q-18 Cancellation rules

- **Default:**
  - The requester, while still a member, and the org's ORG_ADMINs can cancel future bookings. Admins can cancel anything.
  - No cancellation deadline.
  - Admin cancellations require a reason and notify the org.
- **Consequence:** A late-cancellation policy, if wanted, is the per-room `cancellation_deadline_hours` setting.

### Q-17 Email notifications and mail relay

- **Default:**
  - Email for: new request (to admins, as a digest at most every 15 minutes), decision (to requester), admin cancellation (to org), invitation.
  - Sent via Velferdstinget's or the host's SMTP relay.
  - In-app notifications always.
- **Consequence:**
  - Needs SMTP credentials and SPF/DKIM for the sender domain.
  - **Required for the pilot** (Q-07): invitations and password resets are sent by email. Notifications can stay in-app only if needed.

### Q-21 Session lifetime — **DECIDED 2026-10-13**

- **Decision:** 8 hours idle, 7 days absolute. Invitation links 72 hours, password reset links 30 minutes.
- **Consequence:** Re-login means typing the password (or Google, once linked).

### Q-20 Backup objectives

- **Default:** Nightly backups, at most 24 hours of data loss, about 4 hours to restore, encrypted copy off-site, quarterly restore test.
- **Consequence:** If losing a day of bookings is unacceptable, add WAL archiving (point-in-time recovery). More operational work.

### Q-22 Data retention

- **Default:**
  - Booking history kept. Descriptions and requester identity anonymized after 24 months.
  - Inactive users anonymized after 24 months.
  - Audit log kept 36 months. Notifications 12 months.
- **Consequence:** Velferdstinget should confirm these against their own policies (for example accounting or reporting needs) and put them in the privacy notice.

### Q-23 Capacity and attendee count

- **Default:** Optional "forventet antall deltakere" field. A warning, not an error, if it exceeds the room capacity.
- **Consequence:** Making it mandatory or enforced is a validation change.

### Q-24 Who are the Velferdstinget admins, and how many?

- **Decided (bootstrap):** the first `SYSTEM_ADMIN` is created with a one-time CLI command on the server, which refuses to run once any `SYSTEM_ADMIN` exists. Further admins are invited by that admin.
- **Default:** A small number (2–5) of `SYSTEM_ADMIN`s.
- **Consequence:** If many people approve requests for different buildings, see Q-19.

### Q-25 Language

- **Default:** Norwegian bokmål only, as in the prototype.
- **Consequence:** International students may struggle. i18n later means extracting strings and moving server messages to codes. Moderate effort, easier if done before the UI grows much.

### Q-29 Membership renewal

- **Default:** Memberships have an optional expiry date, which ORG_ADMINs can set, for example at the end of the board term.
- **Consequence:** Without expiry, ex-members keep access until someone removes them.

### Q-26 Repository hosting and CI

- **Default:** GitHub (the README mentions possibly using fribyte's GitHub organization), GitHub Actions for CI, GHCR for images.
- **Consequence:**
  - GitHub is used for development only, so "no external cloud services" still holds at runtime.
  - If this isn't acceptable, a self-hosted Gitea/Forgejo with a runner works the same way.

---

## C. Can postpone

These don't affect the core design. Revisit after the pilot.

| ID | Question | Why it can wait |
|---|---|---|
| Q-02 | Replace Google Calendar entirely? Import existing events? | ICS feeds give people their bookings in Google Calendar. A one-time import tool is planned for Phase 6 if needed. |
| Q-16 | Permission templates or organization categories | Room defaults plus bulk editing come first. Categories are a contained addition (`DATABASE_DESIGN.md` §4). |
| Q-19 | Room or building managers (approve only for their rooms) | Needs a `room_managers` table and a check in approve. Only matters if approvals are split between people. |
| Q-27 | Open-source the project? | If yes (GPLv3-compatible), FullCalendar's Premium resource-timeline view (a "rooms × time" grid) can be used free of charge. Otherwise, build a simple custom grid or buy a licence. |
| Q-28 | Waitlist when a room is taken | Nice to have. Requires notifications on cancellation. |
| Q-31 | Usage statistics and reports for Velferdstinget | Data is in place; reporting can come later. |
| Q-32 | Equipment and room attributes ("projector", "accessible") with search | `rooms.description` covers it initially. |
| Q-33 | Public unauthenticated calendar view (see Q-05) | An extra endpoint later if wanted. |
