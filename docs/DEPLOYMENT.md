# Running in production

How to run the booking system on a server with Docker Compose, behind your own HTTPS reverse proxy. The images are either pulled prebuilt from the GitHub Container Registry (built by CI on every push to `main`) or built on the server from this checkout.

`compose.prod.yaml` runs three containers:

| Service | What | Reachable from |
|---|---|---|
| `frontend` | Nginx: the built React app, and `/api/` passed on to the backend | The host, on `HTTP_BIND:HTTP_PORT` (default `127.0.0.1:8080`). Your reverse proxy points here. |
| `backend` | The Spring Boot API | Only `frontend` |
| `db` | PostgreSQL 18, data in the Docker volume `vt-booking-prod_pgdata` | Only `backend` |

All three restart automatically (`unless-stopped`) and have healthchecks. The development settings are not included.

## Requirements

- Docker with Compose v2, `make` and `git`. About 2 GB of RAM is enough.
- An HTTPS reverse proxy in front. **HTTPS is required:** the session cookie is `Secure`, so logging in over plain HTTP doesn't work.

## Reverse proxy

Point the proxy at `http://HTTP_BIND:HTTP_PORT` and have it:

- pass the original `Host` header,
- send the client's address in `X-Forwarded-For` (appended, as most proxies do) or `X-Real-IP`.

Then tell Nginx which proxy to trust, in `.env`:

- `TRUSTED_PROXY`: the proxy's address **as Nginx sees it**, or a CIDR range. Only requests from there may set the client address.
- `REAL_IP_HEADER`: `X-Forwarded-For` or `X-Real-IP`.

To find the address, start the system, open the site through the proxy, and look at the first field of the `frontend` lines in `make prod-logs`. If the proxy runs on the same host, it is usually the Docker network's gateway (for example `172.27.0.1`). Set `TRUSTED_PROXY` to it, run `make prod-up`, and check that the logs now show the real client addresses. If Docker's networks are recreated with other addresses later, check again.

This matters for security: logins are limited per address: 60 attempts a minute in Nginx, and 100 failed attempts in 15 minutes in the API. With the default (`127.0.0.1`, trust nothing), every user has the proxy's address and shares these limits, so a single person could block everyone's login for 15 minutes. Never trust a wider range than the proxy itself: whoever is trusted can choose their address.

## First start

```bash
git clone <this repository> vt-booking && cd vt-booking
cp .env.example .env && chmod 600 .env
# Edit .env: DB_PASSWORD (for example `openssl rand -hex 32`), HTTP_BIND/HTTP_PORT, TRUSTED_PROXY/REAL_IP_HEADER
make prod-up                  # builds the images (a few minutes) and starts; waits until healthy
make prod-bootstrap-admin     # interactive: email, name and password of the first administrator
```

`prod-bootstrap-admin` only works once: it refuses as soon as any system administrator exists. Further users are created in the app, under **Administrasjon**.

## Everyday commands

| Command | |
|---|---|
| `make prod-up` | Start (or apply changes in `.env`). Pulls the images the first time, or builds them if the pull fails. |
| `make prod-down` | Stop. The database is kept. |
| `make prod-logs` | Follow the logs |
| `docker compose -f compose.prod.yaml ps` | Status and health |

Restarting the backend logs everyone out: sessions are kept in memory. Run only one instance of each service.

## Updating

### Prebuilt images (recommended)

Every push to `main` (and `dev`) runs `.github/workflows/images.yml`, which publishes two images, each tagged `latest` and with the full commit SHA:

- `ghcr.io/fribyte-code/vt-booking-backend`
- `ghcr.io/fribyte-code/vt-booking-frontend`

```bash
# 1. Back up (below)
git pull                      # only needed if compose.prod.yaml, the Makefile or .env.example changed
make prod-pull                # pulls the images for IMAGE_TAG (default latest) and restarts
```

`IMAGE_TAG` in `.env` selects the version: `latest`, or a commit SHA to pin one. Pushes to `dev` publish the same images tagged `dev`, for a test server; never use `dev` in production. If the packages are private (GHCR's default for organization repositories), log in once on the server with `docker login ghcr.io` using a GitHub token with `read:packages`, or make the packages public under the organization's **Packages** settings.

### Building on the server

```bash
# 1. Back up (below)
git pull
make prod-update              # rebuilds the images from this checkout and restarts
```

Database migrations run automatically when the backend starts. To roll back: restore the backup taken in step 1 (the new version may have changed the database), then either set `IMAGE_TAG` to the previous commit SHA and run `make prod-pull`, or check out the previous version and run `make prod-update`.

## Backup

There is no built-in backup job. Back up the database with `pg_dump`, for example nightly from cron, and copy the files to another machine:

```bash
docker compose -f compose.prod.yaml exec -T db pg_dump -U booking -Fc booking > vt-booking-$(date +%F).dump
```

Run it from the repository directory. The dump contains all data, including password hashes, so store it securely.

## Restore

```bash
docker compose -f compose.prod.yaml stop backend
docker compose -f compose.prod.yaml exec -T db pg_restore -U booking -d booking --clean --if-exists < vt-booking-2026-01-31.dump
docker compose -f compose.prod.yaml start backend
```

This replaces the current data with the dump. Test a restore once before going live.

## Configuration (`.env`)

| Variable | Default | |
|---|---|---|
| `DB_PASSWORD` | none, required | Set before the first start: PostgreSQL stores it when it creates the database. To change it later, change it in PostgreSQL too (`ALTER USER booking PASSWORD '…'`). |
| `HTTP_BIND` | `127.0.0.1` | `0.0.0.0` (or an address) if the proxy is on another machine |
| `HTTP_PORT` | `8080` | |
| `TRUSTED_PROXY` | `127.0.0.1` (trust nothing) | See "Reverse proxy" |
| `REAL_IP_HEADER` | `X-Forwarded-For` | |

## Don'ts

- Don't publish the `backend` or `db` ports. The backend trusts the client address that Nginx sends, so it must only be reachable through Nginx.
- Don't set `SPRING_PROFILES_ACTIVE`. The `dev` profile turns off `Secure` cookies and has a default database password.
- Don't use the development commands on the server (`make dev`, `make up`, `make reset-db`, `make e2e`) or `compose.yaml`. They are for local development; `make reset-db` deletes data.
- Don't run `docker compose -f compose.prod.yaml down -v`: `-v` deletes the database volume.
