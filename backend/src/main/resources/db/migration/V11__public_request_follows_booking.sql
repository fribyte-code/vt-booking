-- A public request's booking is the truth for its time and room. When that booking goes away
-- (cancelled, rejected, or deleted with its room), the request lets go of it: booking_id is
-- cleared, booking_removed_at records it ("Booking slettet"), and a request that isn't rejected
-- goes back to IN_PROGRESS (under arbeid), so the admin can make a new booking. A trigger covers
-- every way a booking ends: single and series cancellations, deactivations and room deletion.

ALTER TABLE public_requests ADD COLUMN booking_removed_at timestamptz;

-- search_path FROM CURRENT: public_requests in the schema the migration ran in, whatever the
-- session's search_path is when a booking changes.
CREATE FUNCTION release_public_request_booking() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
    UPDATE public_requests
    SET booking_id = NULL,
        booking_removed_at = now(),
        status = CASE WHEN status = 'REJECTED' THEN status ELSE 'IN_PROGRESS' END
    WHERE booking_id = OLD.id;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER bookings_closed_release_public_request
    AFTER UPDATE OF status ON bookings
    FOR EACH ROW
    WHEN (OLD.status IN ('APPROVED', 'PENDING') AND NEW.status IN ('CANCELLED', 'REJECTED'))
    EXECUTE FUNCTION release_public_request_booking();

-- Before the foreign key's ON DELETE SET NULL, which would otherwise clear booking_id first.
CREATE TRIGGER bookings_deleted_release_public_request
    BEFORE DELETE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION release_public_request_booking();

-- Requests whose booking was already cancelled or rejected before this migration.
UPDATE public_requests p
SET booking_id = NULL,
    booking_removed_at = coalesce(b.cancelled_at, b.decided_at, now()),
    status = CASE WHEN p.status = 'REJECTED' THEN p.status ELSE 'IN_PROGRESS' END
FROM bookings b
WHERE b.id = p.booking_id AND b.status IN ('CANCELLED', 'REJECTED');
