# Rombooking – Velferdstinget Vest (prototype)

A clickable frontend prototype of a room booking system for Velferdstinget Vest. It is meant for gathering feedback. There is no backend, and all data is stored in the browser's localStorage.

The interface is in Norwegian. See `../README.md` for the full product description.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) and production build to `dist/` |
| `npm run lint` | ESLint |
| `npm test` | Vitest tests for the service layer |
| `npx vitest run -t "acceptance"` | Run a single test by name |

## Demo

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
├── types/              Domain types (match the planned database tables)
├── data/mockData.ts    Users, organizations, rooms and seed bookings
├── services/
│   ├── bookingRules.ts    Pure rules: permissions, overlap, validation
│   └── bookingService.ts  Async "API" on top of localStorage
├── context/            AppProvider: data, current user, UI state, toasts
├── hooks/              useApp, useApprove
├── components/
│   ├── calendar/       FullCalendar wrapper
│   ├── booking/        Booking dialog, details, list item, badges
│   ├── layout/         Top bar, sidebar, user switcher, notifications
│   └── ui/             Button, Modal, form fields, Tabs, Popover, Toaster
└── pages/              CalendarPage, MyBookingsPage, AdminPage
```

- **All business rules live in `services/`.** Components never decide on their own whether something is allowed. The booking form calls `evaluateBooking` only to show feedback, and the service runs the same check again before saving.
- **The service is async and returns JSON-like objects.** Swapping localStorage for `fetch` against Spring Boot only requires changing `bookingService.ts`. The suggested endpoint mapping is in the comment at the top of that file. `actorId` stands in for the logged-in user, whom the backend will get from the session.
- After every change, the app reloads all data, the same way a real client would refetch.
- Times are stored as ISO 8601 strings in UTC. IDs are stable strings.

## Assumptions and decisions

- Pending requests do not reserve the time slot. Several requests can overlap, but only one can be approved. Approving re-checks availability.
- A request is also refused at creation time if the room is already confirmed for that slot, since there's no point applying for an occupied room.
- Bookings can't be made in the past, and requests whose start time has passed can't be approved.
- Users can cancel their own future bookings and requests, and administrators can cancel any of them. Bookings that have already started can't be cancelled.
- The administrator isn't a member of any organization, so they can't make bookings. They approve, reject and cancel.
- A booking can't cross midnight. An end time of 00:00 means the end of the selected day.
- Permissions are stored on the room (`room.permissions[orgId]`) for simplicity. In the database, this becomes the `room_access` table.
- The Inter font is bundled with the app (`@fontsource-variable/inter`), so it isn't fetched from a CDN.

## Known limitations

- **No real authentication or access control.** All checks run in the browser and can be bypassed. In production, Spring Security and the backend must enforce every rule.
- Data lives only in this browser's localStorage. It isn't shared between users or devices, and two open tabs don't synchronize.
- Rooms, organizations and permissions can't be edited in the UI.
- No email notifications, recurring bookings, ICS export or Google Calendar import.
- The bundle is large (~180 kB gzip), mostly because of FullCalendar. That's fine for a prototype, and code splitting can be added later.
