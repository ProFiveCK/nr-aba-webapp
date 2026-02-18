# Production Migration Guide (Preserve Database)

Use this when you are replacing/upgrading the production code but you must keep the existing live PostgreSQL data.

This stack is designed for that scenario because the Postgres volume is **external** (`ron-stack_pgdata`). A normal `docker compose down` will stop containers without deleting the external volume.

## Assumptions

- You are deploying into an existing working directory (for example: `/opt/aba-stack`)
- The external network and volume already exist:
  - Network: `ron-net`
  - Volume: `ron-stack_pgdata`

## Pre-migration safety backup

1) Backup the database:

```bash
mkdir -p archive
docker exec ron-aba-postgres-prod pg_dump -U postgres aba > archive/aba-db-pre-migration-$(date +%Y%m%d-%H%M%S).sql
```

2) Backup the current code directory (optional but strongly recommended):

```bash
tar -czf archive/aba-stack-code-pre-migration-$(date +%Y%m%d-%H%M%S).tar.gz --exclude='archive' .
```

## Migration steps

1) Stop the running stack (containers only):

```bash
docker compose down
```

2) Confirm the DB volume still exists:

```bash
docker volume inspect ron-stack_pgdata >/dev/null
```

3) Update/replace the code:

- If using Git: `git pull origin main`
- If using a tarball: extract the new code into the same directory

4) Ensure the front-end build exists (if you deploy from source):

```bash
cd app/client
npm ci
npm run build
cd ../..
```

5) Start the new stack:

```bash
docker compose up -d --build
```

## Verification

```bash
docker compose ps
curl -fsS http://localhost/health
```

If you see `{"status":"ok"}`, the API can talk to the database and the proxy is routing correctly.
