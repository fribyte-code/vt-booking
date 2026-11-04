-- Which common area of Studentvillaen a public request is for. The admin picks the actual room
-- when making the booking; FESTPLASSEN and TORGALLMENNINGEN are matched to rooms by name.
ALTER TABLE public_requests
    ADD COLUMN preferred_area varchar(16) NOT NULL DEFAULT 'NO_PREFERENCE'
        CHECK (preferred_area IN ('FESTPLASSEN', 'TORGALLMENNINGEN', 'NO_PREFERENCE'));
