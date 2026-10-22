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
| 7. Limits on duration and number of bookings? | Duration and horizon built, quotas open (Q-10) |

## A. Settled, as built

| ID | Topic | What is built |
|---|---|---|
| Q-01 | Backend | Spring Boot (Java 21) with PostgreSQL |
| Q-07 | Login | Email and password only. No Google, no Feide, no self-registration, no email. Administrators create accounts with a temporary password that must be changed at first login; existing accounts get in-app invitations to organizations. |
| Q-04 | Organization admins | ORG_ADMINs manage members and roles in their own active organization, and edit or cancel its bookings. Only SYSTEM_ADMINs approve or reject requests and manage rooms and access. |
| Q-24 | First administrator | One-time `bootstrap-admin` command on the server. Further administrators are created by an administrator. |
| Q-03 | Pending requests and the slot | Pending requests don't reserve it. Several may overlap; only one can be approved. A request for an already approved slot is refused. |
| Q-06 | Visibility of pending requests | Only the requesting organization and SYSTEM_ADMINs see them. |
| Q-12 | Recurring bookings | Weekly or every 2nd–4th week up to an end date, 2–52 occurrences, the last within 180 days. Each occurrence is its own booking. A series can be approved or rejected as a whole; occurrences that can't be approved are reported. |
| Q-14 | Reduced access | Removing a membership or disabling a user withdraws their future pending requests. Approved bookings stay unless the admin chooses to cancel them when closing a room, archiving an organization or disabling a user. A lost room permission doesn't cancel anything, but stops approval. |
| Q-15 | Moving bookings | Allowed for the requester, the organization's admins and SYSTEM_ADMINs, by drag and drop or "Endre". A move into a room that needs approval makes the booking a request again, except when a SYSTEM_ADMIN moves an approved booking. |
| Q-18 | Cancellation | The requester (while a member), the organization's admins and SYSTEM_ADMINs can cancel bookings that haven't started. No deadline. A reason is optional and shown to the organization. |
| Q-17 | Email | None. Notifications are in-app only; "read" is remembered per browser. |
| Q-21 | Session lifetime | 8 hours idle. The 7-day absolute limit decided earlier is **not** implemented. |
| Q-25 | Language | Norwegian bokmål only |

## B. Still open

### Before going live

- **Q-05 Calendar visibility.** Built default: every logged-in user sees other organizations' approved bookings with time, room, title and organization name, but not the description or who booked. Titles can contain personal data, so users should be told that titles are visible to everyone logged in. Alternatives: show only "Opptatt", or a public calendar.
- **Q-08 Data protection.** Is Velferdstinget the data controller? Who signs the data processing agreement with the host, and who writes the privacy notice ("personvernerklæring")? Needed before real users.
- **Q-09 Hosting.** Where does it run (fribyte?), on which hostname, and is there an existing reverse proxy, TLS setup, backup target or monitoring to use? This decides the production setup in `DEPLOYMENT.md`.
- **Q-20 Backups.** Proposed: nightly, at most 24 hours of data loss, about 4 hours to restore, an encrypted off-site copy and a quarterly restore test.
- **Q-22 Data retention.** How long are bookings, descriptions and inactive accounts kept? Nothing is deleted or anonymized today.
- **Q-34 Who may create accounts?** Today an ORG_ADMIN who adds an unknown email creates a global account and sees its temporary password. With no email verification, any ORG_ADMIN can create accounts for any address. The alternative is that only SYSTEM_ADMINs create accounts, and ORG_ADMINs only invite existing ones.

### Can be decided from pilot use

- **Q-10 Quotas.** Built: at most 12 hours per booking and 180 days ahead. Not built: limits on the number of pending requests or future bookings per user or organization.
- **Q-11 Crossing midnight.** The booking form doesn't allow it (an end time of 00:00 means the end of the day); the API allows any booking up to 12 hours. Are overnight events needed?
- **Q-13 Fixed reservations ("faste tider").** Today an administrator can only create a weekly series as a member of the organization. Are admin-made reservations on behalf of an organization, or room blocks for maintenance, needed?
- **Q-23 Attendee count.** Rooms have a capacity, but bookings have no attendee count.
- **Q-29 Membership renewal.** Memberships don't expire. Should they, for example at the end of a board term?
- **Q-26 Repository hosting and CI.** GitHub with Actions, or a self-hosted alternative?

### Can wait

| ID | Question |
|---|---|
| Q-02 | Replace Google Calendar entirely? Import existing events? |
| Q-16 | Permission templates or organization categories for many organizations |
| Q-19 | Room or building managers who approve only for their rooms |
| Q-27 | Open-source the project? |
| Q-28 | Waitlist when a room is taken |
| Q-31 | Usage statistics and reports |
| Q-32 | Equipment and room attributes with search |
| Q-33 | Public calendar without login (see Q-05) |
| — | ICS calendar feeds |
