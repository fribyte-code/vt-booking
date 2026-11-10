-- Rooms that can be asked for in the public form (/soknad), opening hours per room, and contact
-- persons on public requests. The public form now names a room instead of a fixed common area, and
-- no longer asks about a villa guard (every event must have one; the form only says so).

ALTER TABLE rooms ADD COLUMN public_requestable boolean NOT NULL DEFAULT false;
-- The two common areas the form offered until now.
UPDATE rooms SET public_requestable = true WHERE lower(btrim(name)) IN ('festplassen', 'torgallmenningen');

-- A room with no rows is open around the clock (apart from the global 05:00–07:00, ClosedHours).
-- With rows, a booking must lie within its start day's interval; days without a row are closed.
-- Minutes after local midnight (booking.time-zone); closes_minute 1440 means 24:00.
CREATE TABLE room_opening_hours (
    room_id       uuid     NOT NULL REFERENCES rooms ON DELETE CASCADE,
    day_of_week   smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- ISO 8601: 1 = Monday
    opens_minute  smallint NOT NULL CHECK (opens_minute BETWEEN 0 AND 1439),
    closes_minute smallint NOT NULL CHECK (closes_minute BETWEEN 1 AND 1440),
    PRIMARY KEY (room_id, day_of_week),
    CONSTRAINT room_opening_hours_closes_after_opens CHECK (closes_minute > opens_minute)
);

-- The room asked for: null for "Ingen preferanse". The name is kept, so a request still shows it
-- after the room is deleted (the id is then set null).
ALTER TABLE public_requests
    ADD COLUMN preferred_room_id   uuid REFERENCES rooms ON DELETE SET NULL,
    ADD COLUMN preferred_room_name varchar(80);
UPDATE public_requests SET preferred_room_name = CASE preferred_area
    WHEN 'FESTPLASSEN' THEN 'Festplassen'
    WHEN 'TORGALLMENNINGEN' THEN 'Torgallmenningen'
END;
UPDATE public_requests p SET preferred_room_id = r.id
FROM rooms r
WHERE p.preferred_room_name IS NOT NULL AND lower(btrim(r.name)) = lower(p.preferred_room_name);
ALTER TABLE public_requests
    DROP COLUMN preferred_area,
    DROP COLUMN needs_villa_guard,
    ADD CONSTRAINT public_requests_room_has_name CHECK (preferred_room_id IS NULL OR preferred_room_name IS NOT NULL);

-- Who is responsible at the event. Requests sent before this have none; new ones have 1–10.
-- card_number is the UiB card number, never the student number.
CREATE TABLE public_request_contacts (
    request_id   uuid         NOT NULL REFERENCES public_requests ON DELETE CASCADE,
    position     smallint     NOT NULL CHECK (position BETWEEN 0 AND 9),
    name         varchar(100) NOT NULL CHECK (btrim(name) <> ''),
    organization varchar(120) NOT NULL CHECK (btrim(organization) <> ''),
    card_number  varchar(20)  NOT NULL CHECK (card_number ~ '^[0-9]{4,20}$'),
    phone        varchar(20)  NOT NULL CHECK (phone ~ '^\+?[0-9]{8,15}$'),
    PRIMARY KEY (request_id, position)
);
