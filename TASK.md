# Production Deployment Task — Security Fixes

This file tracks the manual steps required when deploying the security fixes from branch `security/fix-vibesec-findings` to production. These cannot be automated via git because they touch the live database and runtime secrets on the production host.

## Background

The following vulnerabilities were fixed in code (see the commit history on this branch):

1. JWT verification now enforces `algorithms: ['HS256']` (blocks `alg:none` / algorithm-confusion).
2. AI Helper `/api/ai-helper/chat` now requires authentication; role is taken from the session, not the client.
3. CSP `scriptSrc` no longer allows `'unsafe-inline'`.
4. Added a CSRF Origin guard for state-changing requests.
5. Mass assignment fixed in thresholds/whitelist/blacklist PUT handlers (explicit field allowlists).
6. Reviewer passphrase endpoints now require admin auth + rate limiting; passphrase hashing upgraded to bcrypt (legacy SHA-256 still accepted for verification).
7. SMTP password stored in the DB is now encrypted with AES-256-GCM using `SMTP_ENC_KEY`.
8. AI Helper chat rendering now HTML-escapes before applying markdown (XSS fix).
9. `.env.prod.example` documents `SMTP_ENC_KEY`.

None of these changes require a database migration. The schema is unchanged.

## Pre-deployment (on the production host, before pulling the new code)

### 1. Back up the current state

```bash
# From the production host, in the repo directory
docker exec ron-aba-postgres-prod pg_dump -U postgres aba > backup-$(date +%Y%m%d-%H%M%S).sql
cp .env.prod .env.prod.bak.$(date +%Y%m%d-%H%M%S)
```

### 2. Rotate the JWT secret

Generate a new secret:
```bash
openssl rand -hex 48
```
Store the result — you will put it in `.env.prod` in step 6.

> Impact: all existing user sessions are invalidated. Every user will be logged out and must sign in again. This is expected and safe.

### 3. Generate an SMTP encryption key

```bash
openssl rand -hex 32
```
Store the result — this is `SMTP_ENC_KEY`, used to encrypt SMTP passwords saved via the Admin UI.

> If SMTP was previously configured via the Admin UI, that stored password will no longer decrypt after you change the key. You will need to re-enter the SMTP password in Admin > SMTP Settings after deployment.

### 4. Change the Postgres password (REQUIRED — do this before updating .env.prod)

The `ron-stack_pgdata` volume already exists in production, so changing `POSTGRES_PASSWORD` in `.env.prod` alone will NOT update the actual database password — it would cause the API to crash-loop with auth failures. You must change it inside Postgres first.

Run this while the current (old) stack is still running:
```bash
NEW_PG_PASSWORD=$(openssl rand -hex 24)
echo "New DB password: $NEW_PG_PASSWORD"
docker exec -it ron-aba-postgres-prod psql -U postgres -c "ALTER USER postgres PASSWORD '$NEW_PG_PASSWORD';"
```
Save `$NEW_PG_PASSWORD` — you will put it in `.env.prod` in step 6.

## Deployment

### 5. Pull the new code

```bash
git fetch
git checkout main          # or whichever branch you merge into
git pull
# If merging a PR: merge the PR on GitHub first, then pull main here
```

### 6. Update .env.prod on the production host

Edit `.env.prod` and set these values (do NOT copy the local dev `.env.prod` — it has dev-only values like `FRONTEND_BASE_URL=http://localhost:8080`):

```
JWT_SECRET=<value from step 2>
POSTGRES_PASSWORD=<value from step 4>
DB_PASSWORD=<same value as POSTGRES_PASSWORD>
SMTP_ENC_KEY=<value from step 3>
```

Also remove or comment out `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_PASSWORD` / `DEFAULT_ADMIN_NAME` if they are still present — the default admin should already exist and you don't want it re-created or re-flagged.

### 7. Rebuild and restart the stack

```bash
docker compose up -d --build
```

Watch the logs to confirm it comes up cleanly:
```bash
docker compose logs -f api
```
You should see `RON ABA backend listening on port 4000` and no database connection errors.

## Post-deployment verification

### 8. Verify the app is healthy

```bash
curl -s http://localhost:4000/health
# expect: {"status":"ok"}
```

Open the site in a browser and confirm:
- You can log in (old sessions were invalidated — this is expected).
- The admin account still works. If you previously used `Admin123!` and haven't changed it, change it now via Admin > User Accounts or sign in and use Change Password.

### 9. Re-enter the SMTP password (if SMTP was configured via Admin UI)

Because `SMTP_ENC_KEY` is new, any previously stored SMTP password cannot be decrypted. Go to Admin > SMTP Settings and re-enter the SMTP password, then click Test to verify.

### 10. Clean up the backup files

Once everything is confirmed working for a few days:
```bash
rm backup-*.sql
rm .env.prod.bak.*
```

## Rollback (if something breaks)

```bash
# Restore the old env file
cp .env.prod.bak.<timestamp> .env.prod

# Revert the code
git checkout <previous-commit-hash>

# Rebuild
docker compose up -d --build
```

If you rolled back the DB password change too, also restore the old postgres password:
```bash
docker exec -it ron-aba-postgres-prod psql -U postgres -c "ALTER USER postgres PASSWORD '<old-password-from-backup-env>';"
```

## Summary checklist

- [ ] Backup DB + .env.prod
- [ ] Generate new JWT_SECRET
- [ ] Generate new SMTP_ENC_KEY
- [ ] ALTER USER postgres password in the live DB
- [ ] Pull new code
- [ ] Update .env.prod (JWT_SECRET, POSTGRES_PASSWORD, DB_PASSWORD, SMTP_ENC_KEY; remove DEFAULT_ADMIN_*)
- [ ] `docker compose up -d --build`
- [ ] Verify /health and login
- [ ] Re-enter SMTP password in Admin UI
- [ ] Clean up backups after a few days