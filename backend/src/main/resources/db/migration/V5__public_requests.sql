-- Booking requests for Studentvillaen sent from the public form (/soknad), without an account.
-- A system admin reads them, rejects them or turns them into an ordinary booking.

CREATE TABLE public_requests (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email              varchar(254)  NOT NULL,
    organization_name  varchar(120)  NOT NULL CHECK (btrim(organization_name) <> ''),
    -- "Medlem av Kulturstyret eller Studentersamfunnet?"
    member_of_kulturstyret_or_samfunnet boolean NOT NULL,
    start_at           timestamptz   NOT NULL,
    end_at             timestamptz   NOT NULL,
    description        varchar(2000) NOT NULL CHECK (btrim(description) <> ''),
    needs_villa_guard  boolean       NOT NULL,
    status             varchar(11)   NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'TRANSFERRED', 'REJECTED')),
    created_at         timestamptz   NOT NULL DEFAULT now(),
    -- The booking made from the request. Set null if the booking is deleted with its room.
    booking_id         uuid REFERENCES bookings ON DELETE SET NULL,

    CONSTRAINT public_requests_end_after_start CHECK (end_at > start_at)
);
CREATE INDEX public_requests_created_idx ON public_requests (created_at);
