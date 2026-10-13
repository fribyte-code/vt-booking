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

3. Log in as one of the seeded users, such as `kari@example.no` or `admin@example.no`, with the password `dev`. The full list is in `../backend/README.md`.

To run the end-to-end workflow test against the running backend (login, direct booking, double-booking refusal, request, approval, rejection, cancellation and logout):

```bash
E2E_BASE_URL=http://localhost:5173 npx vitest run apiWorkflow
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

## Features

- Day, week and month views (FullCalendar) with Norwegian formatting. Week view is the default, and phones open in day view.
- Per-room colors, room filters, and a toggle for pending requests.
- Click or drag in the calendar to create a booking. Click a booking to see its details.
- The booking form gives live feedback on permissions, availability and time validation.
- Admin page with pending requests, a history of processed requests, and read-only overviews of permissions and users.
- **Mine bookinger** has upcoming, pending, rejected and past bookings, plus cancellation.
- Notification bell for decisions on your own requests.

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
│   └── bookingRules.ts     Pure rules: permissions, overlap, validation
├── context/            AppProvider: session, data, UI state, toasts
├── hooks/              useApp, useApprove
├── components/
│   ├── calendar/       FullCalendar wrapper
│   ├── booking/        Booking dialog, details, list item, badges
│   ├── layout/         Top bar, sidebar, user switcher (demo), account menu (API), notifications
│   └── ui/             Button, Modal, form fields, Tabs, Popover, Toaster
└── pages/              CalendarPage, MyBookingsPage, AdminPage, LoginPage (API)
```

- **One interface, two implementations.** Components use `useApp()`, and `AppProvider` calls the `DataSource`. Demo-only features (`demo.switchUser`, `demo.reset`) and API-only ones (`auth.login`, `auth.logout`) are optional parts of the interface.
- **The backend decides.** In API mode, identity comes from the session, and every permission and booking rule is enforced by Spring Boot. The booking form still calls `evaluateBooking` for live feedback, but the server's answer (a Problem Details `code` and Norwegian `detail`) is what the user sees.
- **Loading.** API mode loads the calendar's visible range (at most 62 days), the user's own bookings, and for administrators the request queue and user list. The data is reloaded when the calendar moves outside the loaded range and after every change. A spinner next to the calendar title shows a reload in progress.
- **Errors.** A 401 sends the user back to the login page. A `VERSION_CONFLICT` or `INVALID_STATE` reloads the data, because someone else changed the booking. Network failures and server errors are shown as toasts, or as a retry screen before the first load.
- **CSRF.** The API client reads the `XSRF-TOKEN` cookie and sends it as `X-XSRF-TOKEN` on every POST. It fetches `/api/auth/csrf` when the cookie is missing, for example after login, and retries once if the token is refused.
- Times are ISO 8601 strings in UTC. IDs are opaque strings: readable in demo mode and UUIDs in API mode.

## Assumptions and decisions

- Pending requests do not reserve the time slot. Several requests can overlap, but only one can be approved. Approving re-checks availability.
- A request is also refused at creation time if the room is already confirmed for that slot, since there's no point applying for an occupied room.
- Bookings can't be made in the past, and requests whose start time has passed can't be approved.
- Rejecting a request requires a reason, which the requester sees. This matches the API.
- Users can cancel their own future bookings and requests, and administrators can cancel any of them. Bookings that have already started can't be cancelled.
- The administrator isn't a member of any organization, so they can't make bookings. They approve, reject and cancel.
- A booking can't cross midnight. An end time of 00:00 means the end of the selected day.
- Permissions are stored on the room (`room.permissions[orgId]`) for simplicity. In the database, this becomes the `room_access` table.
- The Inter font is bundled with the app (`@fontsource-variable/inter`), so it isn't fetched from a CDN.

## Known limitations

- **Demo mode has no real authentication or access control.** All checks run in the browser and can be bypassed. API mode relies on the backend for both.
- API mode only has the backend's development login (`dev` profile). Feide/Google login isn't implemented, so the production backend currently refuses every login.
- In demo mode, data lives only in this browser's localStorage. It isn't shared between users or devices, and two open tabs don't synchronize.
- The API has no notifications yet. In API mode, "Merk alle som lest" is remembered per browser in localStorage.
- In API mode, the booking form's live conflict hint and the admin page's conflict warnings only know about the loaded bookings. The server always checks again.
- The cancel button follows the demo rule (own bookings, or administrator). The API also lets organization admins cancel their organization's bookings, but the UI doesn't offer it yet.
- Rooms, organizations and permissions can't be edited in the UI.
- No email notifications, recurring bookings, ICS export or Google Calendar import.
- The bundle is large (~180 kB gzip), mostly because of FullCalendar. That's fine for a prototype, and code splitting can be added later.
