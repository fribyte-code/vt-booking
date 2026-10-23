# Rombooking – Velferdstinget Vest (frontend)

The React frontend of the room booking system for Velferdstinget Vest. The same UI runs in two data modes, chosen at build time with `VITE_DATA_MODE`:

| Mode | Data | Login |
|---|---|---|
| `demo` | Mock users and data in the browser's localStorage. No network requests. | Simulated user switcher |
| `api` | The Spring Boot API in `../backend/` and PostgreSQL | Real session cookie with CSRF |

The interface is in Norwegian. See `../README.md` for the full product description.

## Getting started

The root `Makefile` covers the common tasks: `make demo`, `make dev`, `make test`, `make e2e` and `make up`. The npm commands below are what it runs.

```bash
npm install
npm run dev        # demo mode, http://localhost:5173
```

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server in **demo** mode |
| `npm run dev:api` | Dev server in **API** mode. Proxies `/api` to `http://localhost:8080` (override with `API_PROXY_TARGET`). |
| `npm run build` | Type-check and **production** build to `dist/`. Always API mode. |
| `npm run build:demo` | Type-check and standalone **demo** build to `dist/`, for hosting the clickable prototype |
| `npm run lint` | ESLint |
| `npm test` | Vitest tests for the service layer and both data sources |
| `npx vitest run -t "acceptance"` | Run a single test by name |

### Running in API mode

From the repository root, `make dev` does all of the steps below in one command, and `make up` runs everything in Docker behind Nginx (see the root `README.md`). To do it by hand:

1. Start the database and the backend with the `dev` profile (see `../backend/README.md`):

   ```bash
   cd ../backend
   docker compose up -d --wait
   ./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
   ```

2. Start the frontend in API mode:

   ```bash
   npm run dev:api    # http://localhost:5173
   ```

3. The database starts empty. The first time, create a system administrator from the repository root with `make bootstrap-admin` (it asks for email, name and password), and log in with it. Create organizations, rooms and other users under **Administrasjon**; new users get a temporary password that they must change at first login.

To run the end-to-end workflow test against the running local backend (login, forced password change, direct booking, double-booking refusal, request, approval, rejection, cancellation and logout), log in as a system administrator of the local database (`make bootstrap-admin` creates one). The test creates its own organizations, rooms and users through the admin API with random names, and afterwards disables the users and archives the rest; it never connects to the database. It refuses a base URL that isn't `localhost`, `127.0.0.1` or `[::1]`, and an API with a `Secure` session cookie (anything but the `dev` profile). Archived test data stays in the development database until `make reset-db`.

```bash
E2E_BASE_URL=http://localhost:5173 E2E_ADMIN_EMAIL=you@example.no E2E_ADMIN_PASSWORD=... npx vitest run apiWorkflow
```

`npm test` skips it when `E2E_BASE_URL` isn't set.

### "Prøv demo" next to the real app

The login page shows **Prøv demo** when the build sets `VITE_DEMO_URL`. The link leads to a separate demo build, which can link back with `VITE_LOGIN_URL`. The two builds never share code paths: the demo has no API client, and the API build has no mock data.

| Where | API app | Demo |
|---|---|---|
| `make dev` | http://localhost:5173 (`VITE_DEMO_URL` in `.env.api`) | http://localhost:5174/demo/ |
| `make up` | http://localhost:8088 | http://localhost:8088/demo/ (built when the image's `WITH_DEMO=true`) |
| Production (`npm run build`, default image) | No link | Not built |

The demo build uses `--base /demo/`, and the router reads `import.meta.env.BASE_URL`. Without `VITE_LOGIN_URL`, for example with `make demo` or `npm run build:demo`, the demo has no link to a login.

### How the mode is chosen

- `VITE_DATA_MODE` comes from `.env` (`demo`, used by `npm run dev` and tests), `.env.api` (`--mode api`), `.env.demo` (`--mode demo`) and `.env.production` (`api`).
- `vite.config.ts` stops the build if the value is anything other than `demo` or `api`, or if a production build isn't `api`. That also covers a `VITE_DATA_MODE=demo` override in the shell.
- The value is inlined at build time. Code that only demo mode uses is guarded by `IS_DEMO` (`src/config.ts`) and is left out of API builds: mock data, the demo service, the user switcher and "Tilbakestill demodata". In the same way, API builds contain the login page and the API client, and demo builds don't.
- The demo data source never makes network requests, so demo users and data can't reach an API. The API client only calls the same origin (`/api/...`), which Vite proxies in development and Nginx in production.

## Demo mode

Use the user switcher at the top right to change who is "logged in":

| User | Organization(s) | Notes |
|---|---|---|
| Kari Nordmann | Organisasjon A | Default user |
| Ola Hansen | Organisasjon B | |
| Ingrid Berg | Organisasjon C | |
| Jonas Lie | Organisasjon A and C | Picks which organization to book for |
| Silje Aas | – | Administrator |

Booking permissions:

| Organization | Møterom A | Møterom B | Storsalen |
|---|---|---|---|
| Organisasjon A | DIRECT | REQUEST | REQUEST |
| Organisasjon B | DIRECT | NONE | REQUEST |
| Organisasjon C | NONE | DIRECT | REQUEST |

The sample data is generated relative to today's date, so the current and following weeks always have activity. It includes several pending requests:

- One request conflicts with a confirmed booking and can't be approved.
- Two requests compete for the same time slot.
- One request has been rejected, and its user has an unread notification.

To get back to the initial state, use **"Tilbakestill demodata"** at the bottom of the sidebar.

### Suggested walkthrough

1. As Kari, select a time in the week view and book Møterom A. The booking is confirmed immediately.
2. Try booking the same time again. The form shows that the room is taken.
3. Apply for Storsalen. The request shows up striped with a dashed border.
4. Switch to Silje and approve the request under **Administrasjon**.
5. Switch back to Kari. The booking is confirmed under **Mine bookinger**, and the bell shows a notification.
6. Drag one of Kari's bookings to another time in the week view, or open it and choose **Endre**.
7. Create a booking with **Gjenta: Ukentlig**. The form lists the dates and marks taken ones, which you can skip. Open one of the occurrences to see the series, and cancel "this and all following".

## Features

- Day, week and month views (FullCalendar) with Norwegian formatting. Week view is the default, and phones open in day view.
- Per-room colors, room filters, and a toggle for pending requests.
- Click or drag in the calendar to create a booking. Click a booking to see its details.
- The booking form gives live feedback on permissions, availability and time validation. It loads the chosen room's bookings for the chosen day, so dates outside the calendar's range are checked too.
- **Editing.** "Endre" in the booking details (and in Mine bookinger) opens the booking form prefilled; the organization is fixed. The form warns when a new room or time turns an approved booking into a new request that loses its slot until approved. Bookings in archived rooms can only get a new title or description.
- **Drag and drop.** Bookings you may edit can be dragged and resized in the calendar. A move that changes the status, or moves one occurrence of a series, is confirmed first; a refused move snaps back with a toast.
- **Weekly series.** "Gjenta" (weekly, or every 2nd/3rd/4th week, up to and including a date) previews the dates with taken ones marked, and can skip them. Details show "Del av en gjentakende serie" with the dates. Editing an occurrence offers "Bare denne" or "Denne og alle følgende"; the latter is first run as a dry run that lists what changes and which dates are taken. Cancelling offers this one, this and following, or the whole series. Administrators approve or reject a whole series, and the admin queue groups a series' open requests into one expandable item.
- Admin page with pending requests and a history of processed requests. In API mode also users, organizations, rooms and access. Closing or archiving a room, archiving an organization and deactivating a user first lists the affected future bookings and asks whether to cancel or keep them.
- **Mine bookinger** has upcoming, pending, rejected and past bookings, with editing and cancellation.
- Notification bell for decisions on your own requests and for cancellations by others. In API mode it also shows invitations to organizations, which are shown as a banner too and can be accepted or declined.
- **Members** (API mode, organization admins): adding an existing account sends an invitation that the person must accept; a new email creates an account with a temporary password. Pending invitations can be withdrawn.
- Bookings in archived rooms keep their room name and are shown in a neutral grey.

## Architecture

```text
src/
├── config.ts           IS_DEMO, from VITE_DATA_MODE
├── types/              Domain types shared by both data sources
├── data/mockData.ts    Demo users, organizations, rooms and seed bookings
├── services/
│   ├── dataSource.ts       The DataSource interface the UI talks to
│   ├── index.ts            Picks the demo or API data source at build time
│   ├── demoDataSource.ts   Demo: simulated user over bookingService
│   ├── bookingService.ts   Demo: async "API" on top of localStorage
│   ├── apiDataSource.ts    API: maps Spring Boot responses onto the shared types
│   ├── apiClient.ts        API: fetch, CSRF token, Problem Details → BookingError
│   ├── adminApi.ts         API: user, organization, room, member and invitation management
│   └── bookingRules.ts     Pure rules: permissions, overlap, validation, edits, series dates
├── context/            AppProvider: session, data, UI state, toasts
├── hooks/              useApp, useSeriesPreview
├── components/
│   ├── calendar/       FullCalendar wrapper, move confirmation
│   ├── booking/        Booking dialog (create, edit, series), details, cancel and decision dialogs, list item, badges
│   ├── admin/          Management tabs (API mode), future-bookings confirmation
│   ├── layout/         Top bar, sidebar, user switcher (demo), account menu (API), notifications
│   └── ui/             Button, Modal, form fields, Tabs, Popover, Toaster
└── pages/              CalendarPage, MyBookingsPage, AdminPage; API only: LoginPage, ChangePasswordPage, OrgMembersPage
```

- **One interface, two implementations.** Components use `useApp()`, and `AppProvider` calls the `DataSource`. Editing and series (`updateBooking`, `series.*`) exist in both. Demo-only features (`demo.switchUser`, `demo.reset`) and API-only ones (`auth.*`, `invitations.*`) are optional parts of the interface. Management (deactivation, members, org invitations) calls `adminApi.ts` directly and is only rendered in API mode.
- **The backend decides.** In API mode, identity comes from the session, and every permission and booking rule is enforced by Spring Boot. The booking form still calls `evaluateBooking` / `evaluateEdit` for live feedback, but the server's answer (a Problem Details `code` and Norwegian `detail`) is what the user sees.
- **Loading.** API mode loads the signed-in user, rooms, organizations, invitations, the calendar's visible range (at most 62 days), the user's own bookings, and for administrators the request queue. The first load reuses the `/api/me` answer of the session check. Other people's names come with the bookings, so the user list is only loaded by the management pages. The data is reloaded when the calendar moves outside the loaded range and after every change; "Merk alle som lest" only updates the loaded data. A spinner next to the calendar title shows a reload in progress.
- **Errors.** A 401 sends the user back to the login page. A `VERSION_CONFLICT` or `INVALID_STATE` reloads the data, because someone else changed the booking. Network failures and server errors are shown as toasts, or as a retry screen before the first load.
- **CSRF.** The API client reads the `XSRF-TOKEN` cookie and sends it as `X-XSRF-TOKEN` on every POST. It fetches `/api/auth/csrf` when the cookie is missing, for example after login, and retries once if the token is refused.
- Times are ISO 8601 strings in UTC. IDs are opaque strings: readable in demo mode and UUIDs in API mode.

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
- A booking can't cross midnight. An end time of 00:00 means the end of the selected day.
- The frontend keeps each room's effective permission per organization on the room (`room.permissions[orgId]`). In API mode the server computes it from the room's default and the `room_access` overrides.
- The Inter font is bundled with the app (`@fontsource-variable/inter`), so it isn't fetched from a CDN.

## Known limitations

- **Demo mode has no real authentication or access control.** All checks run in the browser and can be bypassed. API mode relies on the backend for both.
- API mode logs in with email and password only. There is no Google or Feide login, and no password reset by email: an administrator resets the password, and the user gets a temporary one.
- In demo mode, data lives only in this browser's localStorage. It isn't shared between users or devices, and two open tabs don't synchronize.
- The API has no notifications yet. In API mode, "Merk alle som lest" is remembered per browser in localStorage.
- In API mode, the booking form's live conflict hint and the admin page's conflict warnings only know about the loaded bookings. The server always checks again.
- The demo has no organization admins, invitations or management pages; it shows a read-only overview instead.
- In API mode, the series list in the booking details comes from the server, but only occurrences in the loaded data can be opened from it.
- Deactivation and invitation flows exist only in API mode.
- No email notifications, ICS export or Google Calendar import.
- The main bundle is large (about 190 kB gzip), mostly because of FullCalendar. The management pages are loaded separately.
