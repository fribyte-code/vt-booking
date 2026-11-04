-- The shared organization for public requests from groups that are not in the system. The only
-- data the application creates itself: no members and no room access overrides. Bookings for it
-- are made by a system admin from a public request. Skipped if an organization with this name
-- (in any case) already exists, e.g. one an admin created by hand.
INSERT INTO organizations (name) VALUES ('Eksterne') ON CONFLICT DO NOTHING;
