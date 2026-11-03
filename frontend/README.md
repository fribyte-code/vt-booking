# Rombooking – Velferdstinget Vest (frontend)

The React frontend of the room booking system for Velferdstinget Vest. It talks to the Spring Boot API in `../backend/` (PostgreSQL) with a session cookie and CSRF. The interface is in Norwegian. See `../README.md` for the full product description.

## Getting started

The root `Makefile` covers the common tasks: `make dev`, `make test`, `make e2e` and `make up`. The npm commands below are what it runs.

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on http://localhost:5173. Proxies `/api` to `http://localhost:8080` (override with `API_PROXY_TARGET`). |
| `npm run build` | Type-check and production build to `dist/` |
| `npm run lint` | ESLint |
| `npm test` | Vitest tests for the booking rules, the API data source and helpers |
| `npx vitest run -t "acceptance"` | Run a single test by name |

### Running locally

From the repository root, `make dev` does all of the steps below in one command, and `make up` runs everything in Docker behind Nginx (see the root `README.md`). To do it by hand:

1. Start the database and the backend with the `dev` profile (see `../backend/README.md`):

   ```bash
   cd ../backend
   docker compose up -d --wait
   ./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
   ```

2. Start the frontend:

   ```bash
   npm install
   npm run dev        # http://localhost:5173
   ```

3. The database starts empty. The first time, create a system administrator from the repository root with `make bootstrap-admin` (it asks for email, name and password), and log in with it. Create organizations, rooms and other users under **Administrasjon**; new users get a temporary password that they must change at first login.

To run the end-to-end workflow test against the running local backend (login, forced password change, direct booking, double-booking refusal, request, approval, rejection, cancellation and logout), log in as a system administrator of the local database (`make bootstrap-admin` creates one). The test creates its own organizations, rooms and users through the admin API with random names, and afterwards disables the users and archives the rest; it never connects to the database. It refuses a base URL that isn't `localhost`, `127.0.0.1` or `[::1]`, and an API with a `Secure` session cookie (anything but the `dev` profile). Archived test data stays in the development database until `make reset-db`.

```bash
E2E_BASE_URL=http://localhost:5173 E2E_ADMIN_EMAIL=you@example.no E2E_ADMIN_PASSWORD=... npx vitest run apiWorkflow
```

`npm test` skips it when `E2E_BASE_URL` isn't set.

## Features

- Day, week and month views (FullCalendar) with Norwegian formatting. Week view is the default, and phones open in day view.
- Per-room colors, room filters, and a toggle for pending requests.
- Click or drag in the calendar to create a booking. Click a booking to see its details.
- The booking form gives live feedback on permissions, availability and time validation. It loads the chosen room's bookings for the chosen day, so dates outside the calendar's range are checked too.
- **Editing.** "Endre" in the booking details (and in Mine bookinger) opens the booking form prefilled; the organization is fixed. The form warns when a new room or time turns an approved booking into a new request that loses its slot until approved. Bookings in archived rooms can only get a new title or description.
- **Drag and drop.** Bookings you may edit can be dragged and resized in the calendar. A move that changes the status, or moves one occurrence of a series, is confirmed first; a refused move snaps back with a toast.
- **Weekly series.** "Gjenta" (weekly, or every 2nd/3rd/4th week, up to and including a date) previews the dates with taken ones marked, and can skip them. Details show "Del av en gjentakende serie" with the dates. Editing an occurrence offers "Bare denne" or "Denne og alle følgende"; the latter is first run as a dry run that lists what changes and which dates are taken. Cancelling offers this one, this and following, or the whole series. Administrators approve or reject a whole series, and the admin queue groups a series' open requests into one expandable item.
- Admin page with pending requests, a history of processed requests, and users, organizations, rooms and access. Closing or archiving a room, archiving an organization and deactivating a user first lists the affected future bookings and asks whether to cancel or keep them.
- **Mine bookinger** has upcoming, pending, rejected and past bookings, with editing and cancellation.
- Notification bell for decisions on your own requests and for cancellations by others. It also shows invitations to organizations, which are shown as a banner too and can be accepted or declined.
- **Members** (organization admins): adding an existing account sends an invitation that the person must accept; a new email creates an account with a temporary password. Pending invitations can be withdrawn.
- Bookings in archived rooms keep their room name and are shown in a neutral grey.

## Architecture

```text
src/
├── types/              Domain types
├── services/
│   ├── dataSource.ts       The DataSource interface the UI talks to
│   ├── index.ts            The app's data source
│   ├── apiDataSource.ts    Maps Spring Boot responses onto the domain types
│   ├── apiClient.ts        fetch, CSRF token, Problem Details → BookingError
│   ├── adminApi.ts         User, organization, room, member and invitation management
│   └── bookingRules.ts     Pure rules for live feedback: permissions, overlap, validation, edits
├── context/            AppProvider: session, data, UI state, toasts
├── hooks/              useApp, useSeriesPreview
├── components/
│   ├── calendar/       FullCalendar wrapper, move confirmation
│   ├── booking/        Booking dialog (create, edit, series), details, cancel and decision dialogs, list item, badges
│   ├── admin/          Management tabs, future-bookings confirmation
│   ├── layout/         Top bar, sidebar, account menu, notifications
│   └── ui/             Button, Modal, form fields, Tabs, Popover, Toaster
└── pages/              CalendarPage, MyBookingsPage, AdminPage, LoginPage, ChangePasswordPage, OrgMembersPage
```

- **Data access.** Components use `useApp()`, and `AppProvider` calls the `DataSource`. Management (deactivation, members, org invitations) calls `adminApi.ts` directly.
- **The backend decides.** Identity comes from the session, and every permission and booking rule is enforced by Spring Boot. The booking form still calls `evaluateBooking` / `evaluateEdit` for live feedback, but the server's answer (a Problem Details `code` and Norwegian `detail`) is what the user sees.
- **Loading.** The app loads the signed-in user, rooms, organizations, invitations, the calendar's visible range (at most 62 days), the user's own bookings, and for administrators the request queue. The first load reuses the `/api/me` answer of the session check. Other people's names come with the bookings, so the user list is only loaded by the management pages. The data is reloaded when the calendar moves outside the loaded range and after every change; "Merk alle som lest" only updates the loaded data. A spinner next to the calendar title shows a reload in progress. So that other people's bookings and new requests show up without a page reload, the data is also loaded in the background 30 seconds after the last load while the tab is visible, and when the user comes back to the tab (polling; the API has no push channel). A background load shows no spinner, keeps the old data object when nothing changed, and only reports a lost session.
- **Errors.** A 401 sends the user back to the login page. A `VERSION_CONFLICT` or `INVALID_STATE` reloads the data, because someone else changed the booking. Network failures and server errors are shown as toasts, or as a retry screen before the first load.
- **CSRF.** The API client reads the `XSRF-TOKEN` cookie and sends it as `X-XSRF-TOKEN` on every POST. It fetches `/api/auth/csrf` when the cookie is missing, for example after login, and retries once if the token is refused.
- Times are ISO 8601 strings in UTC. IDs are opaque strings (UUIDs).

## Assumptions and decisions

- Pending requests do not reserve the time slot. Several requests can overlap, but only one can be approved. Approving re-checks availability.
- A request is also refused at creation time if the room is already confirmed for that slot, since there's no point applying for an occupied room.
- Bookings can't be made in the past, and requests whose start time has passed can't be approved.
- Rejecting a request requires a reason, which the requester sees. This matches the API.
- The requester (while still a member), the organization's admins and system administrators can edit and cancel future bookings and requests (`canChangeBooking`). Bookings that have already started can't be changed.
- A new room or time follows the room permission: DIRECT is confirmed at once, REQUEST becomes a new request, except that a system administrator moving an approved booking keeps it approved. A new title or description keeps the status.
- Series occurrences are ordinary bookings with a shared `seriesId`. They keep their local wall-clock time across daylight saving changes. A series has 2–52 occurrences, the last within 180 days.
- Dragging in the calendar moves only that occurrence of a series. To move several, use "Endre" → "Denne og alle følgende".
- The administrator isn't a member of any organization, so they can't make bookings. They approve, reject and cancel.
- A booking can cross midnight: an end time at or before the start time means the next day (still max 12 hours). Such bookings get a "Nattbooking" badge (moon icon), derived from start and end in local time.
- The frontend keeps each room's effective permission per organization on the room (`room.permissions[orgId]`). The server computes it from the room's default and the `room_access` overrides.
- The Inter font is bundled with the app (`@fontsource-variable/inter`), so it isn't fetched from a CDN.

## Known limitations

- Login is with email and password only. There is no Google or Feide login, and no password reset by email: an administrator resets the password, and the user gets a temporary one.
- The API has no notifications yet. "Merk alle som lest" is remembered per browser in localStorage.
- The booking form's live conflict hint and the admin page's conflict warnings only know about the loaded bookings. The server always checks again.
- The series list in the booking details comes from the server, but only occurrences in the loaded data can be opened from it.
- No email notifications, calendar subscription feeds or Google Calendar import. "Legg til i kalender" in the booking details only copies a booking or series once: Google and Outlook get add-event links (Outlook can't repeat, Google only regular series), Apple Calendar gets the backend's `.ics` file.
- The main bundle is large (about 190 kB gzip), mostly because of FullCalendar. The management pages are loaded separately.
