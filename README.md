# RON ABA Generator Stack

This repository contains the full stack for the Nauru Treasury ABA generator/review portal.  
It bundles the static front-end, an Express/Node.js API, and supporting operations assets
used to run the production environment.

## 🚀 Quick Start

### New to this project?

**Development Setup** (macOS/Linux):
```bash
./setup-dev.sh

The interactive setup script will:
- ✅ Check prerequisites (Docker, Docker Compose)
- ✅ Guide you through credential configuration
- ✅ Generate secure secrets automatically
- ✅ Set up and start all services

**Access (after setup completes):**

- Linux: <http://localhost>
- macOS (default): <http://localhost:8080>

### Documentation

- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Complete deployment guide (prerequisites, setup, troubleshooting)
- **[QUICK-START-MACOS.md](QUICK-START-MACOS.md)** - macOS-specific development guide
- **[docs/](docs/)** - User guides for submitters, reviewers, and administrators

### Environment Configuration

**Single .env file:** The entire stack uses ONE environment configuration file (`.env.prod`) loaded by Docker Compose for all services.

```bash
# Copy template and configure
cp .env.prod.example .env.prod
nano .env.prod

# Or use interactive setup
./setup-dev.sh
```

---

## High-Level Architecture

| Layer | Location | Notes |
| ----- | -------- | ----- |
| Front-end | `app/client/` | React + TypeScript + Vite app. Build output is served by the `web` (Nginx) container from `app/client/dist/`. |
| API | `app/backend/src/server.js` | Express server providing auth, batch storage, review workflow, lists, and sync triggers. |
| Database | PostgreSQL 15 | Schema is bootstrapped automatically by `app/backend/src/db.js` on API startup. |
| Reverse proxy | `app/docker/nginx.conf` | Serves the SPA at `/`, proxies `/api/` to the API container, and proxies `/health` to the API health endpoint. |
| Ops tooling | `docker-compose.yml`, `scripts/`, `windows-scripts/` | Compose stack plus operational scripts; includes optional Watchtower + Portainer agent. |

Key backend invariants worth monitoring:

- **PD numbers**: `/api/batches` rejects duplicate six-digit PD references unless the submission shares the same `root_batch_id` (i.e. a true resubmission).
- **Duplicate detection**: front-end Generator computes duplicates client-side; metadata is stored with the batch for reviewer visibility.
- **Blacklist enforcement**: both client and server validate submissions against the `blacklist_entries` table before accepting a batch.
- **Testing mode**: reviewer tools can disable outbound email notifications via a backend flag stored in `reviewer_settings`.

---

## Repository Layout

```
.
├── README.md                # (This file)
├── docker-compose.yml       # Production-style stack definition
├── docs/                    # User/reviewer process docs and flow diagrams
├── app/
│   ├── client/              # React/Vite front-end (build output in client/dist)
│   ├── backend/             # Express API (Node 20)
│   ├── docker/nginx.conf    # SPA + API reverse proxy
│   └── Dockerfile           # Legacy static nginx image (not used by docker-compose.yml)
├── windows-scripts/         # Helpers for Windows deployment targets
└── SFTP_SYNC_INTEGRATION.md # Detailed guide for Windows-triggered SFTP sync
```

Legacy folders (`app/src/`, top-level `src/`) are kept for reference and are not used by the current Docker Compose stack.

---

## Running the Stack Locally

### Prerequisites

- Docker Engine + Docker Compose v2
- Node.js 20+ (only required if you want to run the backend directly)
- `npm` for backend dependency installs

### Quick start with Docker Compose

```bash
# from repository root
docker network create ron-net             # once, if not already present
docker volume create ron-stack_pgdata     # once, if not already present
docker compose up --build
```

Services exposed locally:

- Web UI: <http://localhost> (or <http://localhost:8080> on macOS if you used `./setup-dev.sh`)
- API: via the web container at <http://localhost/api/>
- Health: <http://localhost/health>
- Portainer agent (optional): <http://localhost:9001>

Data persists in the `pgdata` named volume. Inspect logs with `docker compose logs -f api`
or substitute `web`, `postgres`, `watchtower`.

### Running components manually

```bash
# backend
cd app/backend
npm install
npm run dev   # watches server.js

# front-end (dev server)
cd ../client
npm install
npm run dev
```

When running the API without Docker, provide a `.env` file (see variables below) and
ensure Postgres is reachable (defaults assume localhost on port 5432).

---

## Environment Configuration

The stack uses `.env.prod` in the root directory (referenced by `docker-compose.yml`). Important keys:

| Variable | Purpose |
| -------- | ------- |
| `PORT` | API listen port (default 4000). |
| `JWT_SECRET` | Secret used to sign reviewer sessions; rotate in production. |
| `REVIEWER_SESSION_MINUTES` | Session lifetime in minutes (default 480). |
| `BCRYPT_ROUNDS` | Work factor for password hashes (default 12). |
| `FRONTEND_BASE_URL` | Absolute URL included in email templates. |
| `REVIEWER_TEMP_PASSWORD_LENGTH` | Length of auto-generated reviewer passwords. |
| `DEFAULT_ADMIN_EMAIL`, `DEFAULT_ADMIN_PASSWORD`, `DEFAULT_ADMIN_NAME` | Optional bootstrap admin account created on first launch. Remove or rotate after provisioning. |
| `DATABASE_URL` | Full Postgres connection string (alternative to host/user/password). |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL` | Individual DB settings if `DATABASE_URL` is not supplied. |
| `BATCH_ARCHIVE_RETENTION_MONTHS` | How many months to keep batches in the hot table before moving them to the history archive (default 12). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `REPLY_TO_EMAIL` | Outbound mail credentials for review notifications and signup flows. If unset, email is disabled gracefully. |
| `SFTP_SYNC_METHOD` | Controls reviewer "Sync now" button behaviour: `database` (default queue entry), `direct` (call Windows service), or `file` (drop trigger file). |
| `WINDOWS_SYNC_URL` | Endpoint for the Windows web service when using the `direct` method. |
| `SYNC_TRIGGER_PATH` | Filesystem path watched by the Windows script when using the `file` method. |
| `SYNC_TIMEOUT` | Milliseconds to wait for a sync confirmation (default 30000). |

The API exposes a `/health` endpoint (proxied via Nginx) that returns `{"status":"ok"}` when
the database and server are responsive.

---

## Database Schema Summary

`backend/src/db.js` initialises all tables automatically. Key tables:

- `reviewers` – authentication accounts and roles (`user`, `reviewer`, `admin`).
- `reviewer_sessions` – active JWT session records.
- `batch_archives` – stored ABA submissions, base64 payloads, status, PD#, department.
- `batch_reviews` – audit trail for submissions/reviews.
- `signup_requests` – pending self-service account requests.
- `whitelist_entries` / `blacklist_entries` – account filters used by Generator/Reader.
- `sanity_thresholds` – optional transaction threshold metadata.
- `sftp_sync_requests` – audit log for on-demand sync triggers.

Indexes are created for common lookups (e.g. batch `root_batch_id`, reviewer ids).
All migrations are idempotent; restarting the API re-applies missing columns safely.

---

## SFTP Sync Options

Reviewer tools can trigger an "urgent" SFTP sync via `/api/saas/sync-trigger`.
Three integration modes exist:

1. `database` (default) – logs a request row for an external scheduler to poll.
2. `direct` – HTTP POST to a Windows-hosted service (see `SFTP_SYNC_INTEGRATION.md`).
3. `file` – creates a trigger file for a PowerShell watcher.

Refer to `SFTP_SYNC_INTEGRATION.md` for detailed PowerShell scripts and deployment tips.
Set `SFTP_SYNC_METHOD` plus either `WINDOWS_SYNC_URL` or `SYNC_TRIGGER_PATH` accordingly.

---

## Backup Service

A scheduled backup job protects code, Postgres data, and database dumps.

- **Backup script**: `scripts/backup-ron-stack.sh`
- **Monitoring + DB backup script**: `scripts/backup-and-monitor.sh`
- **Artifacts**: written under `archive/` by default (override with `ARCHIVE_DIR=...`).
- **Retention**: both scripts are intended to be run via cron; adjust schedules/paths to suit your host.

To check recent artifacts:

```bash
ls -lh archive | tail -n 25
```

If the backup fails, the script logs the failure but continues with remaining steps. Investigate docker volume names,
database container availability, or disk space.

### Batch Archive Retention

The `batch_archives` table stays lean by moving older records into `batch_archives_history`. Keep at least one year of
data in the hot table by running the archival script regularly (e.g., monthly via cron or Watchtower).

```bash
cd app/backend
npm install                              # once
npm run archive:batches -- --dry-run     # see how many batches would move
npm run archive:batches                  # moves rows older than the retention window (default 12 months)
```

Flags:

- `--dry-run` – report how many rows meet the cutoff without moving data
- `--before=2025-01-01T00:00:00Z` – override the cutoff date for catch-up migrations

Set `BATCH_ARCHIVE_RETENTION_MONTHS` in `.env.prod` to change the retention policy. The Admin → Batch Archives view automatically merges the hot and history tables, so admins still see the full dataset even after archival.

---

## Deployment Notes

- **Network**: the compose stack expects an external Docker network named `ron-net`.
  Create it once (`docker network create ron-net`) so that other services (e.g. legacy
  apps, reverse proxies) can share the network.
- **Volumes**: Postgres data lives in the `pgdata` volume. Ensure it is backed up or
  snapshotted before upgrades.
- **Auto updates**: Watchtower container monitors other services with the label
  `com.centurylinklabs.watchtower.enable=true`. Disable it in environments where
  automatic pulls are undesired.
- **Static hosting**: Nginx serves the built front-end from `app/client/dist`. After front-end changes, rebuild with `cd app/client && npm run build`.
- **TLS / CDN**: Production typically sits behind Cloudflare (see past 502 incident).
  Ensure origin health checks hit `/health` and point to the Nginx service/port.

---

## Recovery Procedures

Always validate backups before destroying the running stack. Suggested sequence:

1. **Bring the stack down safely**

   ```bash
   docker compose down        # stop API, web, postgres, watchtower
   ```

2. **Restore application files**

  ```bash
  # replace working tree with the archived tarball
  tar -xzf archive/aba-stack-YYYYMMDD-HHMMSS.tar.gz -C /path/to/restore
  ```

   If you maintain a Git remote, consider re-cloning instead of restoring the tarball.

3. **Restore Postgres data**

   - *Option A – volume snapshot* (preferred when `pgdata` archive exists):

     ```bash
     docker volume rm ron-stack_pgdata          # remove damaged volume (ensure compose is down)
     docker volume create ron-stack_pgdata
     docker run --rm -v ron-stack_pgdata:/data \
       -v "$(pwd)/archive":/backup \
       alpine sh -c "cd /data && tar xzf /backup/ron-stack_pgdata-pgdata-YYYYMMDD-HHMMSS.tar.gz"
     ```

   - *Option B – logical SQL dump*:

     ```bash
     docker compose up -d postgres
     cat archive/aba-db-YYYYMMDD-HHMMSS.sql | \
       docker exec -i ron-aba-postgres-prod psql -U postgres aba
     ```

4. **Restart services**

   ```bash
   docker compose up -d
   docker compose ps
   ```

5. **Verification**
  - Hit `http://<host>/health` (via Nginx).
   - Confirm latest batches exist via Reviewer tab or `SELECT COUNT(*) FROM batch_archives;`.
   - Send a test email (if SMTP configured) and trigger a test SFTP sync if needed.

> Tip: keep a copy of the backup tarballs off-host (cloud storage, S3, etc.) so that a full
> bare-metal failure can be recovered.

---

## Troubleshooting Checklist

| Symptom | Checks |
| ------- | ------ |
| Login fails with 502 | Confirm backend container is healthy (`docker compose ps`, `/health`). Check Cloudflare/origin routing. |
| Users cannot submit batches | Inspect API logs for validation errors (duplicate PD, blocked account). Verify Postgres connectivity. |
| Emails not sending | Validate SMTP env values and turn off testing mode (Reviewer tab). Check `mailTransport` creation in backend logs. |
| "Sync now" button never completes | Ensure `SFTP_SYNC_METHOD` matches the deployed Windows integration. Test the Windows endpoint or watcher manually. |
| Reviewer receives duplicate PD warning unexpectedly | Confirm front-end `currentSubmissionRootId` resets (recent bug fix). Inspect `batch_archives` for existing `pd_number`. |
| Static site changes not visible | If not using bind mounts, rebuild the `web` image (`docker compose build web`). |

Useful commands:

```bash
# Tail API logs
docker compose logs -f api

# Enter Postgres shell
docker compose exec postgres psql -U postgres -d aba

# Check health endpoints
curl http://localhost/health               # via nginx
docker compose exec api node -e "require('http').get('http://127.0.0.1:4000/health', r => { console.log(r.statusCode); process.exit(r.statusCode===200?0:1); }).on('error', () => process.exit(1));"
```

---

## Related Documentation

- `docs/User.md` – Submitter/Level 1 guide.
- `docs/Reviewer.md` – Reviewer/Level 2 guide.
- `docs/Flows.md` – Mermaid diagrams covering lifecycle and roles.
- `SFTP_SYNC_INTEGRATION.md` – Windows sync implementation details.

Keep this README in sync with infrastructure changes so new maintainers or agents
can confidently assess system health and configuration. When introducing new services,
document them here and list any additional environment variables they require.
