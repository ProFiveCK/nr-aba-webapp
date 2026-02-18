# Production Deployment Checklist

Quick checklist for deploying the ABA Stack to a production host.

For full details, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Pre-deployment

- [ ] Docker + Docker Compose v2 installed
- [ ] Port available for the web service (`WEB_PORT`, default `80`)
- [ ] Optional: Port `9001` available if you enable the Portainer agent
- [ ] External Docker network exists: `docker network create ron-net` (one-time)
- [ ] External Postgres volume exists: `docker volume create ron-stack_pgdata` (one-time)
- [ ] `.env.prod` present and reviewed (strong passwords, correct `FRONTEND_BASE_URL`)
- [ ] Backup/rollback plan confirmed (DB dump + volume snapshot)

## Deploy

- [ ] Pull latest code: `git pull origin main`
- [ ] Build the front-end (if you deploy from source):
  - `cd app/client && npm ci && npm run build`
- [ ] Start/upgrade the stack:
  - `docker compose up -d --build`

## Verify

- [ ] Containers healthy: `docker compose ps`
- [ ] Health check: `curl -fsS http://localhost/health` returns `{"status":"ok"}`
- [ ] Web UI loads and you can sign in
- [ ] Reviewer/admin workflows behave as expected

## Post-deployment security

- [ ] Change the bootstrap admin password immediately
- [ ] Remove/comment out `DEFAULT_ADMIN_PASSWORD` in `.env.prod` after initial provisioning
- [ ] Restrict env file permissions: `chmod 600 .env.prod`

## Backups

- [ ] Schedule backups (example):
  - `0 2 * * * /path/to/aba-stack/scripts/backup-and-monitor.sh >> /var/log/aba-stack-backup.log 2>&1`
- [ ] Confirm new artifacts appear under `archive/`
