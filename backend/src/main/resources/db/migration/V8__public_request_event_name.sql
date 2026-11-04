-- The event's name, asked for in the public form and used as the booking title (same 80
-- character limit). Requests sent before this field existed get their organization name.
ALTER TABLE public_requests ADD COLUMN event_name varchar(80);
UPDATE public_requests SET event_name = left(organization_name, 80);
ALTER TABLE public_requests
    ALTER COLUMN event_name SET NOT NULL,
    ADD CONSTRAINT public_requests_event_name_not_blank CHECK (btrim(event_name) <> '');
