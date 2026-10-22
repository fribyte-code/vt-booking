# Deployment plan

**Status: not implemented.** Only the local setup exists (`compose.yaml`, `make up`), and it runs the backend with the `dev` profile (default database password, cookies without `Secure`). This document is the plan for production. It replaces section 9 of `archive/ARCHITECTURE.md`, without the parts that no longer apply (Google login, SMTP, Mailpit).

Requirements from the spec: self-hosted on Velferdstinget's own servers, Docker Compose, Nginx, no external cloud services at runtime.

## What exists today

| Piece | State |
|---|---|
| `backend/Dockerfile` | Multi-stage build, runs as a non-root user, sets no Spring profile |
| `frontend/Dockerfile` and `nginx.conf` | Production build (always API mode), security headers and CSP, `/api/` proxied to `backend:8080`. `WITH_DEMO=true` also serves the demo at `/demo/` (local only). |
| `compose.yaml` | Local stack: PostgreSQL, backend with `SPRING_PROFILES_ACTIVE=dev`, Nginx on `127.0.0.1:8088` |
| First administrator | `docker compose run --rm backend bootstrap-admin` (interactive) |

## Production setup to build

### Containers

| Service | Notes |
|---|---|
| `web` | The frontend image without the demo (`WITH_DEMO=false`). TLS with Let's Encrypt (certbot, webroot challenge) or the host's certificate. If the host already has a TLS reverse proxy, `web` serves plain HTTP on the internal network only. |
| `api` | The backend image with **no** `dev` profile, so session cookies are `Secure`. No published port. |
| `db` | `postgres:18` (pinned), on an internal network, no published port, volume `pgdata` |
| `backup` | A small image with `pg_dump` (and `restic` for off-site copies), run nightly |

- **Startup order:** `depends_on` with `condition: service_healthy` (`db` before `api` before `web`). The API needs a healthcheck first; it has no health endpoint today (Spring Boot Actuator, or a check on `/api/auth/csrf`).
- **HSTS** belongs in `nginx.conf` once HTTPS is in place.
- **Client IP for the login throttle.** Nginx currently appends to the client's `X-Forwarded-For` (`$proxy_add_x_forwarded_for`), and Tomcat trusts every private-network address as a proxy. At the outermost proxy, set the header from `$remote_addr` instead, so clients can't add addresses of their own.

### Configuration and secrets

- Set `DB_URL` (default `jdbc:postgresql://localhost:5432/booking`), `DB_USER` (default `booking`) and `DB_PASSWORD`. Without the `dev` profile, the password defaults to empty, so it must be set.
- Keep secrets out of the repository: an `.env` file with mode `0600` on the server, or Compose `secrets:` read with `spring.config.import=configtree:/run/secrets/`.
- Optional later: a separate database role for Flyway (owner) and a DML-only role for the application.

### Backups and restore

| Item | Proposal (confirm with Velferdstinget, see `OPEN_QUESTIONS.md`) |
|---|---|
| Method | Nightly `pg_dump -Fc`, plus a dump before every deploy |
| Storage | Encrypted, on a different machine or site |
| Retention | 7 daily, 4 weekly, 12 monthly |
| Data loss / restore time | At most 24 hours / about 4 hours |
| Restore test | Quarterly, into a separate database, with a smoke test |

### Logging and monitoring

- The API and Nginx log to stdout; use Docker's `json-file` driver with `max-size` and `max-file` rotation.
- Healthchecks on `db` (`pg_isready`), `api` and `web`.
- Simple uptime monitoring (for example Uptime Kuma, or the host's monitoring): the public URL, certificate expiry, backup freshness and disk space.

### Deploying and rolling back

1. Build versioned images (a version tag and the git SHA).
2. Deploy: take a backup, `docker compose pull`, `docker compose up -d`, then check the login page.
3. Roll back by setting the previous tag and running `up -d`. Migrations must stay backward compatible (expand, then contract in a later release), so the previous version runs on the new schema. If data is damaged, restore the pre-deploy dump.
4. Create the first administrator once with `bootstrap-admin`.

### Limits to keep in mind

- Sessions and the login throttle live in memory: run **one** API instance, and expect a restart to log everyone out.
- Everything fits comfortably on about 2 vCPU, 4 GB RAM and 40 GB disk.
