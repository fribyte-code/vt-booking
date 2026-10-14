-- Booking edits (who changed a booking last, and when), weekly series, and in-app membership
-- invitations for existing accounts.

ALTER TABLE bookings
    ADD COLUMN updated_at    timestamptz,
    ADD COLUMN updated_by_id uuid REFERENCES users,
    -- Occurrences created together as a weekly series share this id. There is no series table:
    -- every occurrence is an ordinary booking that can be edited or cancelled on its own.
    ADD COLUMN series_id     uuid,
    ADD CONSTRAINT bookings_update_recorded
        CHECK ((updated_at IS NULL) = (updated_by_id IS NULL));
CREATE INDEX bookings_series_idx ON bookings (series_id) WHERE series_id IS NOT NULL;

-- An organization admin adding an existing account creates an invitation instead of a
-- membership. The invited user accepts or declines it after logging in.
CREATE TABLE membership_invitations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid        NOT NULL REFERENCES organizations ON DELETE CASCADE,
    user_id         uuid        NOT NULL REFERENCES users ON DELETE CASCADE,
    role            varchar(10) NOT NULL CHECK (role IN ('MEMBER', 'ORG_ADMIN')),
    invited_by_id   uuid        NOT NULL REFERENCES users,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, user_id)
);
CREATE INDEX membership_invitations_user_idx ON membership_invitations (user_id);
