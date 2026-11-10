# Deploy checklist: November 2026 release

For deploying the November 2026 changes (migrations V9–V12) to the test server, and later to Fribyte. The commands are in `DEPLOYMENT.md`; this list is the order and what to check. Tick off as you go.

## 1. Before

- [ ] **Back up the database**, and check that the file isn't empty. V9–V12 can't be undone without the backup.
  ```bash
  docker compose -f compose.prod.yaml exec -T db pg_dump -U booking -Fc booking > vt-booking-$(date +%F)-before-v9.dump
  ls -lh vt-booking-*-before-v9.dump
  ```
- [ ] **See which migrations the server has.** This list assumes V8. If it is further, skip what is done.
  ```bash
  docker compose -f compose.prod.yaml exec -T db psql -U booking -d booking \
    -c "SELECT version, description, installed_on FROM flyway_schema_history ORDER BY installed_rank"
  ```
- [ ] **Villa guard answers (V9).** Decided: the public form no longer asks whether the event needs a villa guard. Every event must have one, and the form says so. V9 therefore **deletes** the old yes/no answers (`public_requests.needs_villa_guard`). Nothing in the app uses them. To keep a record anyway, export them first:
  ```bash
  docker compose -f compose.prod.yaml exec -T db psql -U booking -d booking -c \
    "\copy (SELECT id, organization_name, event_name, start_at, needs_villa_guard FROM public_requests) TO STDOUT WITH CSV HEADER" \
    > villavakt-svar-$(date +%F).csv
  ```
- [ ] Merge `dev` into `main` and push. CI runs the tests and publishes the images.

## 2. Deploy

- [ ] `make prod-pull` (or `make prod-update` when building on the server).
- [ ] `make prod-logs`: Flyway runs the new migrations, and the backend starts.

| Migration | What it changes in existing data |
|---|---|
| V9 | Rooms can be marked "Kan forespørres" (Festplassen and Torgallmenningen are marked automatically when they exist with those names), get opening hours and a managing organization. Public requests get a room instead of a common area (`preferred_area` → `preferred_room_id`/`preferred_room_name`, matched by name) and contact persons. **Drops** `preferred_area` and `needs_villa_guard`. |
| V10 | Handling status for public requests: `TRANSFERRED` becomes `DONE`; adds who edited last and when. |
| V11 | A request whose booking is cancelled or deleted lets go of it and goes back to "Under arbeid" (trigger). Requests whose booking was **already** cancelled are released once: `DONE` becomes `IN_PROGRESS`. |
| V12 | New table `guard_orders` ("Vektere bestilt"). Nothing existing changes. |

- [ ] Check that all four ran:
  ```bash
  docker compose -f compose.prod.yaml exec -T db psql -U booking -d booking \
    -c "SELECT version, success FROM flyway_schema_history WHERE version::int >= 9 ORDER BY installed_rank"
  ```

## 3. Setup in Administrasjon

As a system administrator, under **Administrasjon → Rom og tilganger**:

- [ ] **Museplassen**: create the room if it doesn't exist (name, colour, capacity, access).
- [ ] **Engen**: "Forvaltes av" Studentersamfunnet. Samfunnet needs at least one ORG_ADMIN (the room manager), who then gets "Til godkjenning" in the menu.
- [ ] **Kantina**: opening hours Monday–Friday 16:30–24:00 and Saturday–Sunday 08:00–16:00 ("Kopier til tir–fre" helps).
- [ ] **"Kan forespørres"**: tick the rooms the public form `/soknad` should offer. Check Festplassen and Torgallmenningen, which V9 marked.
- [ ] **Room descriptions** for the requestable rooms: they are shown in the form. Who is prioritized per room goes here (the texts are no longer in the code).
- [ ] **"Eksterne"** exists under Organisasjoner (V7), for bookings made from public requests.

## 4. Smoke test over HTTPS

- [ ] Log in and out. In the browser's developer tools, the session cookie and `XSRF-TOKEN` are `Secure`.
- [ ] `make prod-logs` shows the real client addresses, not the proxy's (`TRUSTED_PROXY`).
- [ ] Six wrong passwords for one email give "for mange forsøk" (429); the right password works again after 15 minutes.
- [ ] Send a request from `/soknad` without logging in.

## 5. Test plan

Run on the test server with test accounts (a system admin, an ORG_ADMIN in Samfunnet, an ordinary member).

**Booking rules**
- [ ] A booking 04:00–06:00 or 06:00–08:00 is refused (closed 05:00–07:00); 22:00–05:00 and 07:00–09:00 work, for admins too.
- [ ] 07:00 to 05:00 the next day (22 hours) works; 15 minutes more is refused.
- [ ] Kantina: 18:00–22:00 on a weekday works, 12:00–14:00 on a weekday is refused with the opening hours in the message, Saturday 10:00–12:00 works.

**Public form `/soknad`**
- [ ] Only the rooms marked "Kan forespørres" are offered, with descriptions, plus "Ingen preferanse".
- [ ] One or more contact persons with card number (not student number) and phone; an invalid field is marked red, and the error is shown at the top.
- [ ] An event past midnight shows the midnight box (villa guard and guards); more than 22 hours is refused.

**Room manager**
- [ ] The ORG_ADMIN in Samfunnet sees "Til godkjenning" with only Engen's applications, and can approve and reject them; the system admin still sees all, with "Forvaltes av".
- [ ] An ordinary member doesn't see it.

**Forespørsler** (system admin)
- [ ] The list is compact; filters by status and "Bare over midnatt" and the order work.
- [ ] A row opens the details; "Opprett booking" makes the booking, and the request becomes "Ferdig" with "Booking opprettet".
- [ ] "Rediger" with a new time moves the booking; a time that collides is refused, and nothing is saved.
- [ ] "Vis i kalenderen" opens the booking in the calendar.
- [ ] Cancelling the booking in the calendar: the request shows "Booking slettet" and is "Under arbeid" again.
- [ ] "Avslå" on a request with a booking asks whether to keep or delete the booking.

**Natt** (system admin)
- [ ] Lists coming events past midnight in every room: bookings, applications and requests; filters by type and room.
- [ ] "Vektere bestilt" records who and when, and the tab's badge goes down; "Send til vektere" opens a ready-made email.
- [ ] Bookings past midnight show the moon in the calendar.

**Other**
- [ ] Brukere: search and filter by organization.
- [ ] The room dialog explains closing, archiving and deleting.

## 6. If something goes wrong

Stop (`make prod-down`), restore the backup from step 1 (`DEPLOYMENT.md`, "Restore"), and go back to the previous images (`IMAGE_TAG` = the previous commit SHA, `make prod-pull`). The old version can't run on the new schema.
