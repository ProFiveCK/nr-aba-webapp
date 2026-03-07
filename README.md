# RON ABA Generator Stack

Full-stack portal for the Nauru Treasury ABA payment file generator and review workflow.  
Runs as a Docker Compose stack: React/Vite front-end · Node.js/Express API · PostgreSQL 15 · Nginx.

---

## First Install

One script handles prerequisites, configuration, and startup on **macOS, Ubuntu/Debian, WSL, and other Linux**:

```bash
git clone https://github.com/YOUR-ORG/nr-aba-webapp.git
cd nr-aba-webapp
chmod +x install.sh
./install.sh
```

The wizard will:

1. **Check & install** missing prerequisites (Docker, Docker Compose, Node.js 20+, Git)
2. **Configure** credentials and generate secure secrets (`.env.prod`)
3. **Create** Docker network (`ron-net`) and database volume (`ron-stack_pgdata`)
4. **Offer** to restore from a SQL backup in `./backup/`
5. **Build** the frontend bundle
6. **Start** all services and print the access URL

> **Default admin:** `admin@example.com` / `Admin123!` — change this on first login.

To verify prerequisites only (no changes):

```bash
./install.sh --check
```

Default ports: **Linux** → `http://localhost` (port 80) · **macOS** → `http://localhost:8080`

---

## Restore a Database Backup

The installer wizard offers restore during first run.  
To restore manually at any time:

```bash
# 1. Make sure the stack is running
docker compose --env-file .env.prod up -d

# 2. Wait for PostgreSQL to be ready
docker exec ron-aba-postgres-prod pg_isready -U postgres

# 3. Restore from a .sql dump
docker exec -i ron-aba-postgres-prod psql -U postgres -d aba < backup/yourfile.sql
```

Backup files live in `./backup/`. See [`scripts/backup-ron-stack.sh`](scripts/backup-ron-stack.sh) for the automated backup script.

---

## Day-to-Day Commands

```bash
docker compose --env-file .env.prod ps           # service status
docker compose --env-file .env.prod logs -f       # tail all logs
docker compose --env-file .env.prod restart       # restart all
docker compose --env-file .env.prod down          # stop all
./install.sh                                      # re-run wizard (reconfigure / rebuild)
```

---

## Architecture

| Layer | Location | Notes |
|-------|----------|-------|
| Front-end | `app/client/` | React + TypeScript + Vite · build output served by Nginx |
| API | `app/backend/src/server.js` | Express · auth, batch storage, review workflow, sync triggers |
| Database | PostgreSQL 15 | Schema auto-bootstrapped by `app/backend/src/db.js` on startup |
| Reverse proxy | `app/docker/nginx.conf` | SPA at `/`, API at `/api/`, health at `/health` |

---

## Environment Reference

All configuration lives in **one file**: `.env.prod` (created by the installer).  
Edit it with `nano .env.prod`, then restart: `docker compose --env-file .env.prod restart`

| Variable | Purpose |
|----------|---------|
| `POSTGRES_PASSWORD` / `DB_PASSWORD` | Database password (must match) |
| `JWT_SECRET` | Signs reviewer sessions — rotate in production |
| `WEB_PORT` | Exposed HTTP port (`80` Linux · `8080` macOS) |
| `FRONTEND_BASE_URL` | Absolute URL used in outbound email links |
| `DEFAULT_ADMIN_EMAIL/PASSWORD/NAME` | Bootstrap admin — remove after provisioning |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Outbound mail (leave blank to disable) |
| `SFTP_SYNC_METHOD` | `database` (default) · `direct` · `file` |
| `REVIEWER_SESSION_MINUTES` | Session lifetime (default 480) |
| `BCRYPT_ROUNDS` | Password hash work factor (default 12) |
| `BATCH_ARCHIVE_RETENTION_MONTHS` | Months before batches move to history archive (default 12) |

---

## Repository Layout

```
install.sh              ← single entry point (prereqs + wizard + start)
docker-compose.yml      ← full stack definition
.env.prod.example       ← configuration template
app/
  client/               ← React/Vite front-end
  backend/              ← Express API (Node 20)
  docker/nginx.conf     ← Nginx reverse proxy config
backup/                 ← SQL dumps + restore-database.sh
scripts/                ← cron helpers (backup, archive, monitoring)
docs/                   ← user & reviewer process guides
windows-scripts/        ← Windows SFTP sync helpers
```

---

## Key Behaviours

- **PD numbers** — `/api/batches` rejects duplicate six-digit PD refs unless they share the same `root_batch_id` (resubmission).
- **Duplicate detection** — computed client-side; stored with the batch for reviewer visibility.
- **Blacklist enforcement** — both client and API validate against `blacklist_entries` before accepting a batch.
- **Email** — disabled gracefully when `SMTP_HOST` is unset.
- **SFTP sync** — reviewer "Sync now" button behaviour controlled by `SFTP_SYNC_METHOD`; see [`DEPLOYMENT.md`](DEPLOYMENT.md) for details.

---

