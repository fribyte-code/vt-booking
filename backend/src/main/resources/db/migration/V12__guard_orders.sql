-- "Vektere bestilt": a system admin ticks off that guards are ordered for an event past midnight,
-- recording who and when. An event is a public request (with or without its booking) or a booking
-- not made from a request; one row per event. A booking made from a request is marked through the
-- request, so the mark survives the booking being made, moved or cancelled.

CREATE TABLE guard_orders (
    booking_id        uuid UNIQUE REFERENCES bookings ON DELETE CASCADE,
    public_request_id uuid UNIQUE REFERENCES public_requests ON DELETE CASCADE,
    ordered_at        timestamptz NOT NULL,
    ordered_by_id     uuid REFERENCES users ON DELETE SET NULL,
    CONSTRAINT guard_orders_one_event CHECK ((booking_id IS NULL) <> (public_request_id IS NULL))
);
