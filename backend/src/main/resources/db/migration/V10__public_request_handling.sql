-- Public requests get a handling status the system admin sets: NEW (ubehandlet), IN_PROGRESS
-- (under arbeid), DONE (ferdig) or REJECTED (avslått). Creating a booking from a request marks it
-- DONE; booking_id still tells whether a booking was made. Admins can also edit a request after
-- it is handled, recorded in updated_at and updated_by_id.

ALTER TABLE public_requests DROP CONSTRAINT public_requests_status_check;
UPDATE public_requests SET status = 'DONE' WHERE status = 'TRANSFERRED';
ALTER TABLE public_requests
    ADD CONSTRAINT public_requests_status_check CHECK (status IN ('NEW', 'IN_PROGRESS', 'DONE', 'REJECTED')),
    ADD COLUMN updated_at    timestamptz,
    ADD COLUMN updated_by_id uuid REFERENCES users ON DELETE SET NULL;
