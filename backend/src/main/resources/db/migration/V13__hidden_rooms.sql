-- "Skjult for de uten tilgang" (Q-40, draft): a room with hidden_without_access is only shown to
-- users who can book it through one of their organizations (effective permission DIRECT or
-- REQUEST), to its managers and to system admins. Others don't see the room in the calendar, nor
-- other organizations' bookings in it. Default false: every room stays visible to everyone.

ALTER TABLE rooms ADD COLUMN hidden_without_access boolean NOT NULL DEFAULT false;
