-- Email/password login (docs/ARCHITECTURE.md §4): account status, password hash, forced
-- password change, and the SYSTEM_ADMIN global role. Nothing is deleted. Existing users keep
-- their data but have no password, so they cannot log in until an administrator resets it.

ALTER TABLE users ALTER COLUMN global_role TYPE varchar(20);
ALTER TABLE users DROP CONSTRAINT users_global_role_check;
UPDATE users SET global_role = 'SYSTEM_ADMIN' WHERE global_role = 'ADMIN';
ALTER TABLE users ADD CONSTRAINT users_global_role_check CHECK (global_role IN ('USER', 'SYSTEM_ADMIN'));

ALTER TABLE users
    ADD COLUMN status               varchar(10) NOT NULL DEFAULT 'ACTIVE'
        CONSTRAINT users_status_check CHECK (status IN ('ACTIVE', 'DISABLED')),
    -- {argon2}-prefixed Argon2id hash from DelegatingPasswordEncoder. NULL means no login possible.
    ADD COLUMN password_hash        varchar(255),
    -- Set when an administrator creates the user or resets the password (a temporary password).
    ADD COLUMN must_change_password boolean     NOT NULL DEFAULT false,
    -- Sessions that logged in before this instant are no longer valid.
    ADD COLUMN password_changed_at  timestamptz,
    ADD COLUMN last_login_at        timestamptz;
