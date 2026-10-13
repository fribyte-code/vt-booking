-- Who approved, rejected or cancelled a booking, and when.

ALTER TABLE bookings
    ADD COLUMN decided_at          timestamptz,
    ADD COLUMN decided_by_id       uuid REFERENCES users,
    ADD COLUMN decision_comment    varchar(300),
    ADD COLUMN cancelled_at        timestamptz,
    ADD COLUMN cancelled_by_id     uuid REFERENCES users,
    ADD COLUMN cancellation_reason varchar(300),
    ADD CONSTRAINT bookings_decision_recorded
        CHECK ((decided_at IS NULL) = (decided_by_id IS NULL)),
    ADD CONSTRAINT bookings_rejection_recorded
        CHECK (status <> 'REJECTED' OR decided_at IS NOT NULL),
    ADD CONSTRAINT bookings_cancellation_recorded
        CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL AND cancelled_by_id IS NOT NULL));
