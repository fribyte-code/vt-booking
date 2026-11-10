# Open questions

Decisions to confirm with Velferdstinget Vest. Section A lists what is settled and how it is built. Section B is still open. The question IDs (Q-xx) are the ones used in `archive/OPEN_QUESTIONS.md` (2026-10-13), which has the original reasoning and alternatives.

Mapping to the README's "Må avklares med Velferdstinget":

| README question | Status |
|---|---|
| 1. Replace Google Calendar entirely? | Open, can wait (Q-02) |
| 2. Multiple organizations per user? | Yes, built |
| 3. Some organizations direct, others request? | Yes, built (DIRECT, REQUEST, NONE per organization and room) |
| 4. Do pending requests reserve the slot? | No, built (Q-03) |
| 5. Who sees which rooms and bookings? | Built with a default, to confirm (Q-05, Q-06) |
| 6. Organizations with their own admins? | Yes, built (Q-04) |
| 7. Limits on duration and number of bookings? | Duration (22 h) and horizon built (Q-10), quotas open |

## A. Settled, as built

| ID | Topic | What is built |
|---|---|---|
| Q-01 | Backend | Spring Boot (Java 21) with PostgreSQL |
| Q-07 | Login | Email and password only. No Google, no Feide, no self-registration, no email. Administrators create accounts with a temporary password that must be changed at first login; existing accounts get in-app invitations to organizations. |
| Q-04 | Organization admins | ORG_ADMINs manage members and roles in their own active organization, and edit or cancel its bookings. Only SYSTEM_ADMINs manage rooms and access. Approving and rejecting: SYSTEM_ADMINs, and room managers (Q-19). |
| Q-24 | First administrator | One-time `bootstrap-admin` command on the server. Further administrators are created by an administrator. |
| Q-03 | Pending requests and the slot | Pending requests don't reserve it. Several may overlap; only one can be approved. A request for an already approved slot is refused. |
| Q-06 | Visibility of pending requests | Only the requesting organization, the room's managers and SYSTEM_ADMINs see them. |
| Q-12 | Recurring bookings | Weekly or every 2nd–4th week up to an end date, 2–52 occurrences, the last within 180 days. Each occurrence is its own booking. A series can be approved or rejected as a whole; occurrences that can't be approved are reported. |
| Q-14 | Reduced access | Removing a membership or disabling a user withdraws their future pending requests. Approved bookings stay unless the admin chooses to cancel them when closing a room, archiving an organization or disabling a user. A lost room permission doesn't cancel anything, but stops approval. |
| Q-15 | Moving bookings | Allowed for the requester, the organization's admins and SYSTEM_ADMINs, by drag and drop or "Endre". A move into a room that needs approval makes the booking a request again, except when a SYSTEM_ADMIN moves an approved booking. |
| Q-18 | Cancellation | The requester (while a member), the organization's admins and SYSTEM_ADMINs can cancel bookings that haven't started. No deadline. A reason is optional and shown to the organization. |
| Q-17 | Email | No SMTP: the system sends no email. Notifications are in-app only; "read" is remembered per browser. Replies to public requests and orders to the guards are `mailto:` links with ready-made text, which the admin reads through and sends from their own mail app (decided November 2026). |
| Q-21 | Session lifetime | 8 hours idle. The 7-day absolute limit decided earlier is **not** implemented. |
| Q-25 | Language | Norwegian bokmål only |
| Q-11 | Crossing midnight | Allowed (max 22 hours, Q-10). An end time at or before the start time means the next day. Such bookings get a "Nattbooking" badge. Administrasjon → Natt lists every coming event past midnight, where an admin ticks off "Vektere bestilt" (who and when are stored); nobody is notified. |
| Q-35 | Closed hours | No room can be used between 05:00 and 07:00 local time, by anyone, admins and the public form included. Ending at 05:00 or starting at 07:00 is fine. |
| Q-10 | Max duration | 22 hours for every booking, application and public request: 07:00 to 05:00 the next day, the longest the closed hours leave. One constant (`BookingLimits` / `MAX_DURATION_HOURS`). It was 12 hours, a guess from the prototype's security audit to stop one organization from holding a room for days or years. With the closed hours that can't happen at 22 hours either, and the public requests already allowed 22 (raised November 2026). The 180-day horizon is unchanged. |
| Q-36 | Opening hours | Optional per room, one interval per weekday (Kantina: Monday–Friday 16:30–24:00, Saturday–Sunday 08:00–16:00). A booking must lie within its start day's interval. Changing the hours keeps existing bookings. |
| Q-19 | Room managers | A room can be managed by an organization ("Forvaltes av", e.g. Engen by Studentersamfunnet). Its ORG_ADMINs see, approve and reject applications for that room, alongside the system admins. No separate role. Only system admins change rooms and handle public requests. |
| Q-37 | Public requests | External groups apply without an account at `/soknad` for the rooms marked "Kan forespørres", with 1–10 responsible persons (the 6-digit number on the UiB card, not the student number, and phone; Q-39 settled November 2026). Every event needs a villa guard; the form says so and no longer asks. A system admin books it for "Eksterne"; the booking is then the truth for time and room. |

## B. Still open

### Before going live

- **Q-05 Calendar visibility.** Built default: every logged-in user sees other organizations' approved bookings with time, room, title and organization name, but not the description or who booked. Titles can contain personal data, so users should be told that titles are visible to everyone logged in. Alternatives: show only "Opptatt", or a public calendar.
- **Q-08 Data protection.** Is Velferdstinget the data controller? Who signs the data processing agreement with the host, and who writes the privacy notice ("personvernerklæring")? Needed before real users.
- **Q-09 Hosting.** Where does it run (fribyte?), on which hostname, and is there an existing reverse proxy, TLS setup, backup target or monitoring to use? This decides the production setup in `DEPLOYMENT.md`.
- **Q-20 Backups.** Proposed: nightly, at most 24 hours of data loss, about 4 hours to restore, an encrypted off-site copy and a quarterly restore test.
- **Q-22 Data retention.** How long are bookings, descriptions and inactive accounts kept? Nothing is deleted or anonymized today.
- **Q-38 Guards' address.** Where does "Send til vektere" send to? `GUARDS_EMAIL` in `frontend/src/services/publicRequests.ts` is empty, so the admin types the address in the mail app.
- **Q-40 Hiding rooms.** Should some rooms be hidden from some people or organizations? Today every logged-in user sees every active room in the calendar; access `NONE` only stops booking. Should `NONE` also hide the room, or is a separate setting needed?
- **Q-41 Room descriptions and managers.** The texts for Festplassen and Torgallmenningen (who is prioritized) shown in the form, and who in Studentersamfunnet is ORG_ADMIN and so manages Engen. Set in Administrasjon; see `DEPLOY_CHECKLIST.md`.
- **Q-34 Who may create accounts?** Today an ORG_ADMIN who adds an unknown email creates a global account and sees its temporary password. With no email verification, any ORG_ADMIN can create accounts for any address. The alternative is that only SYSTEM_ADMINs create accounts, and ORG_ADMINs only invite existing ones.

### Can be decided from pilot use

- **Q-10 Quotas.** Duration (22 hours) and horizon (180 days) are settled (section A). Not built: limits on the number of pending requests or future bookings per user or organization.
- **Q-13 Fixed reservations ("faste tider").** Today an administrator can only create a weekly series as a member of the organization. Are admin-made reservations on behalf of an organization, or room blocks for maintenance, needed?
- **Q-23 Attendee count.** Rooms have a capacity, but bookings have no attendee count.
- **Q-29 Membership renewal.** Memberships don't expire. Should they, for example at the end of a board term?
- **Q-26 Repository hosting and CI.** GitHub with Actions, or a self-hosted alternative?

### Can wait

| ID | Question |
|---|---|
| Q-02 | Replace Google Calendar entirely? Import existing events? |
| Q-16 | Permission templates or organization categories for many organizations |
| Q-27 | Open-source the project? |
| Q-28 | Waitlist when a room is taken |
| Q-31 | Usage statistics and reports |
| Q-32 | Equipment and room attributes with search |
| Q-33 | Public calendar without login (see Q-05) |
| — | ICS calendar feeds |
