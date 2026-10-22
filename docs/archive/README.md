# Archive: design-phase documents

These documents were written on 2026-10-13, before and while the backend was built. They describe options, plans and a security audit of the frontend-only prototype. **They do not describe the current system** and are kept only for their reasoning and history.

What changed since they were written:

- **Login:** email and password only. No Google or Feide, no SMTP, no email invitations or reset links. Administrators create accounts with a temporary password; existing accounts get in-app invitations.
- **Not built:** audit log, quotas on pending requests, ICS feeds, calendar import, fixed reservations and room blocks, membership expiry, separate database roles, Spring Session, the `/api/v1` prefix.
- **Built differently:** weekly series have 2–52 occurrences with no weekday selection, and changing a room permission does not auto-reject pending requests (approval re-checks it instead).
- The audit's VULN and RISK findings were addressed in the backend. `SECURITY_AUDIT.md` refers to the prototype, not to the current code.

For the current state, see:

- `../ARCHITECTURE.md`: how the system works today
- `../../backend/README.md`: API reference and how the rules are enforced
- `../../frontend/README.md`: data modes, demo and frontend structure
- `../DEPLOYMENT.md`: the production deployment plan (not implemented yet)
- `../OPEN_QUESTIONS.md`: what is decided and what is still open with Velferdstinget

The migrations `V1__core_schema.sql` and `V3__password_auth.sql` still mention `docs/DATABASE_DESIGN.md` and `docs/ARCHITECTURE.md` in their comments. Applied migrations are never edited, so those files are here.
