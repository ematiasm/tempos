# Deploying tempos to a DO VPS with Traefik

tempos ships with the upstream full-stack deployment layout:
a `compose.yml` with a Traefik integration (public network `traefik-public`,
Let's Encrypt TLS via the `le` certresolver, `https-redirect` middleware),
plus GitHub Actions workflows (`deploy-staging.yml`, `deploy-production.yml`)
for self-hosted runners. This document covers the manual / primary path.

## Architecture

```
Internet ──► Traefik (external `traefik-public` network)
                ├── https://dashboard.<DOMAIN>  → frontend (nginx, dist/)
                └── https://api.<DOMAIN>        → backend (FastAPI :8000)
                                   backend ──► postgres (internal network only)
```

## 1. Provision the droplet

- Create a DO droplet: Ubuntu 24.04 LTS, at least 2 GB RAM / 1 vCPU.
  Docker and the compose plugin are installed via `snap` or the official
  convenience script:
  ```bash
  curl -fsSL https://get.docker.com | sh
  ```
- Add a firewall rule allowing 80/tcp and 443/tcp (Traefik handles TLS).
- Point DNS at the droplet public IP:
  - `A dashboard.<DOMAIN>` → IP
  - `A api.<DOMAIN>` → IP
  - (optional) `A <DOMAIN>` → IP if you want adminer/traefik UI subdomains

## 2. Environment file

Copy `.env.production.example` from the repo to the server as `/opt/tempos/.env`
and fill every value (SECRET_KEY, POSTGRES_PASSWORD, FIRST_SUPERUSER_*,
DOMAIN, STACK_NAME). The frontend build needs `VITE_API_URL` — `compose.yml`
already passes `https://api.${DOMAIN}` as a build arg.

```bash
mkdir -p /opt/tempos && cp .env.production.example /opt/tempos/.env
$EDITOR /opt/tempos/.env
```

## 3. First deploy

From a machine with the repo checked out:

```bash
scripts/deploy.sh root@<DROPLET_IP>
```

The script uploads the env file, clones/pulls the repo, builds both images
and starts the stack. The `prestart` service runs migrations and seeds the
first superuser on first boot.

Manual equivalent:

```bash
cd /opt/tempos
git pull origin master
docker compose -f compose.yml --project-name "$(grep '^STACK_NAME=' .env | cut -d= -f2)" build
docker compose -f compose.yml --project-name "$(grep '^STACK_NAME=' .env | cut -d= -f2)" up -d
docker compose ps
```

## 4. Verify

```bash
docker compose logs -f backend
curl -s https://api.<DOMAIN>/api/v1/utils/health-check/   # → true
```

Then log in at `https://dashboard.<DOMAIN>` with the FIRST_SUPERUSER
credentials. First-time things to set: Business Settings (General tab),
payment methods and financial accounts (Admin → Finance), and your catalog.

## 5. Backups (PostgreSQL)

Backup (cron daily, e.g. `/etc/cron.d/tempos-backup`):

```bash
#!/bin/sh
docker exec "$(docker ps -qf 'name=db-1')" \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip > "/var/backups/tempos/$(date +%F).sql.gz"
# keep 30 days
find /var/backups/tempos -name '*.sql.gz' -mtime +30 -delete
```

Also copy dumps off-box (DO Spaces, rclone, etc.).

Restore:

```bash
gunzip -c /var/backups/tempos/2026-08-01.sql.gz \
  | docker exec -i "$(docker ps -qf 'name=db-1')" \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

## 6. Logs, rollback, updates

- Logs: `docker compose -f compose.yml logs -f --tail=200 backend`
- Rollback: `docker compose -f compose.yml pull` with a pinned `TAG`, or
  `git checkout <previous-tag> && docker compose ... up -d --build`
- Update: `scripts/deploy.sh` again (builds latest, `up -d` keeps the volume,
  zero downtime).

## 7. CI option (self-hosted runner)

The template workflows (`deploy-staging.yml`, `deploy-production.yml`) deploy
via self-hosted runners tagged `staging`/`production` on the VPS and
environment secrets (`DOMAIN_STAGING`, `STACK_NAME_STAGING`, `SECRET_KEY`,
`POSTGRES_PASSWORD`, ...). If you prefer push-to-deploy, register a runner on
the droplet, create the environments/secrets in the repo settings, and push to
`master`. The manual path above is otherwise equivalent.

## 8. Notes

- The `db` service is on the internal network only; it is not exposed by
  Traefik. Use `docker compose exec db psql` for admin access.
- `.env` at the repo root is the local-dev file; the server keeps its own
  `.env` under `/opt/tempos`. Never commit production secrets.
- SMTP (password recovery) is optional; leave the SMTP_* values empty to
  disable it.
