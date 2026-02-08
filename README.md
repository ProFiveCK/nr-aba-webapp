# RON ABA Generator Stack

This repository contains the full stack for the Nauru Treasury ABA generator/review portal.  
It bundles the static front-end, an Express/Node.js API, and supporting operations assets
used to run the production environment.

## 🚀 Quick Start

### New to this project?

**Development Setup** (macOS/Linux):
```bash
./setup-dev.sh
```

The interactive setup script will:
- ✅ Check prerequisites (Docker, Docker Compose)
- ✅ Guide you through credential configuration
- ✅ Generate secure secrets automatically
- ✅ Set up and start all services

**Access:** http://localhost after setup completes.

### Documentation

- **[DEPLOYMENT.md](DEPLOYMENT.md)** - Complete deployment guide (prerequisites, setup, troubleshooting)
- **[QUICK-START-MACOS.md](QUICK-START-MACOS.md)** - macOS-specific development guide
- **[docs/](docs/)** - User guides for submitters, reviewers, and administrators

---

## High-Level Architecture

| Layer | Location | Notes |
| ----- | -------- | ----- |
| Front-end | `app/src/index.html` | Single-page application served statically via Nginx. Handles Generator, Reader, My Batches, Reviewer, and Admin workflows. Uses localStorage for draft persistence. |
| API | `app/backend/src/server.js` | Express server providing authentication, batch storage, review workflow, blacklist/whitelist, SFTP sync trigger, etc. |
| Database | PostgreSQL 15 | Schema bootstrapped automatically by `backend/src/db.js`. Stores reviewers, batches, review history, sync requests, lists, etc. |
| Reverse proxy | `app/docker/nginx.conf` | Routes `/` to static assets and `/api/` to the backend container. Exposes `/health` for uptime checks. |
| Ops tooling | Root `docker-compose.yml`, `SFTP_SYNC_INTEGRATION.md`, `windows-scripts/` | Compose stack with Postgres, API, static web, and Watchtower. Optional integration documents for Windows-based SFTP sync. |

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
│   ├── src/                 # Static front-end (HTML + JS + Tailwind CDN)
│   ├── backend/             # Express API (Node 20+)
│   ├── docker/nginx.conf    # Static site + API reverse proxy
│   └── Dockerfile           # Multi-stage build for static assets (currently copy-only)
├── update/                  # Legacy API snapshot (kept for reference; not deployed)
├── windows-scripts/         # Helpers for Windows deployment targets
└── SFTP_SYNC_INTEGRATION.md # Detailed guide for Windows-triggered SFTP sync
```

The `update/` folder mirrors an older iteration of the API. New work should happen in
`app/backend/`; retain the legacy folder only for historical audits.

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
docker compose up --build
```

Services exposed locally:

- Web UI: <http://localhost:9001>
- API: <http://localhost:4000> (internal to compose; proxied via Nginx)
- Postgres: internal only (no published port)

Data persists in the `pgdata` named volume. Inspect logs with `docker compose logs -f api`
or substitute `web`, `postgres`, `watchtower`.

### Running components manually

```bash
# backend
cd app/backend
npm install
npm run dev   # watches server.js

# front-end: open app/src/index.html in a static server (e.g. live-server)
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
| `REVIEWER_SESSION_MINUTES` | Session length override for reviewer portal. |

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

- **Script**: `/home/fmis/scripts/backup-ron-stack.sh`
- **Scheduler**: invoked daily at `00:00` UTC by the host's cron service (see
  `/home/fmis/scripts/backup-ron-stack-cron.log` for run history).
- **Locking**: uses `/home/fmis/.backup_ron_stack.lock` to prevent overlapping runs.
- **Artifacts** (retained for 15 days by default):
  - `/home/fmis/archive/ron-stack-rev-<timestamp>.tar.gz` — repository snapshot.
  - `/home/fmis/archive/<volume>-pgdata-<timestamp>.tar.gz` — Docker volume (`pgdata`) archive.
  - `/home/fmis/archive/aba-db-<timestamp>.sql` — logical database dump via `pg_dump`.
- **Log files**: `/home/fmis/archive/backup-<timestamp>.log` per run, plus the rolling
  `/home/fmis/scripts/backup-ron-stack-cron.log`.

To check the latest run:

```bash
tail -n 40 /home/fmis/scripts/backup-ron-stack-cron.log
ls -lh /home/fmis/archive | grep 2025
```

If the backup fails, the script logs the failure but continues with remaining steps. Investigate docker volume names,
database container availability, or disk space.

### Batch Archive Retention

The `batch_archives` table stays lean by moving older records into `batch_archives_history`. Keep at least one year of
data in the hot table by running the archival script regularly (e.g., monthly via cron or Watchtower).

```bash
cd /home/fmis/Stacks/aba-stack/app/backend
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
- **Static hosting**: Nginx serves files straight from `app/src`. Any front-end
  edits are reflected immediately without rebuilding the container (volume-mounted in compose).
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
   tar -xzf /home/fmis/archive/ron-stack-rev-YYYYMMDD-HHMMSS.tar.gz -C /home/fmis
   ```

   If you maintain a Git remote, consider re-cloning instead of restoring the tarball.

3. **Restore Postgres data**

   - *Option A – volume snapshot* (preferred when `pgdata` archive exists):

     ```bash
     docker volume rm ron-aba-generator_pgdata          # remove damaged volume (ensure compose is down)
     docker volume create ron-aba-generator_pgdata
     docker run --rm -v ron-aba-generator_pgdata:/data \
         -v /home/fmis/archive:/backup \
         alpine sh -c "cd /data && tar xzf /backup/ron-aba-generator_pgdata-pgdata-YYYYMMDD-HHMMSS.tar.gz"
     ```

   - *Option B – logical SQL dump*:

     ```bash
     docker compose up -d postgres
     cat /home/fmis/archive/aba-db-YYYYMMDD-HHMMSS.sql | \
         docker exec -i ron-aba-postgres psql -U postgres aba
     ```

4. **Restart services**

   ```bash
   docker compose up -d
   docker compose ps
   ```

5. **Verification**
   - Hit `http://<host>:9000/health` (Nginx) and `http://<host>:4000/health` (API).
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
curl http://localhost:9000/health          # via nginx
curl http://localhost:4000/health          # direct API
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
