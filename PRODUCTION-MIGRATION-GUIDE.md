# Production Migration Guide: aba-stack-rev

**Scenario:** Replace existing production code with new `aba-stack-rev` while **preserving the existing production database**

**Date:** December 9, 2025  
**Migration Type:** Code replacement + Database preservation  
**Downtime:** ~5-10 minutes

---

## 🎯 Migration Overview

You have:
- ✅ **Old production system** running on server with live database
- ✅ **New codebase** (`aba-stack-rev`) developed on macOS, ready to deploy
- ✅ **Goal:** Replace code, keep production database intact

### Key Difference from Fresh Deployment
❌ **DO NOT** restore from backup - the production DB is already live and current  
✅ **DO** reuse the existing Docker volume containing production data

---

## 📋 Pre-Migration Checklist

### 1. Identify Current Production Setup

**SSH into production server and run:**

```bash
# Find current stack location
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"

# Check for existing containers (likely names)
# - ron-aba-postgres-prod
# - ron-aba-backend-prod
# - ron-aba-generator-prod
# - watchtower-ronstack

# Identify the volume name for database
docker volume ls | grep pgdata

# Common names: ron-stack_pgdata or similar

# Check current working directory
docker inspect ron-aba-postgres-prod | grep -A 5 "Source"
```

**Expected findings:**
- Container name: `ron-aba-postgres-prod` ✅
- Volume name: `ron-stack_pgdata` (external: true) ✅
- Network: `ron-net` (external) ✅
- Current port: `80` (direct HTTP)
- Stack location: `/home/fmis/Stacks/aba-stack`
- Server: `fmis@fs01.naurufinance.info`

### 2. Verify Database Compatibility

**Check schema version on production:**

```bash
docker exec -it ron-aba-postgres-prod psql -U postgres -d aba -c "
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public' 
  ORDER BY table_name;
"
```

**Compare with new code's schema** in `app/backend/src/db.js`

Both `aba-stack-dev` and `aba-stack-rev` should have the same schema since they're the same project lineage. The backend auto-migrates missing columns/tables, so this should be safe.

### 3. Create Safety Backup

**CRITICAL: Backup production database before migration!**

```bash
# On production server
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Create backup
docker exec ron-aba-postgres-prod pg_dump -U postgres aba > \
  /home/fmis/archive/aba-db-pre-migration-${TIMESTAMP}.sql

# Verify backup
ls -lh /home/fmis/archive/aba-db-pre-migration-*.sql

# Keep this backup safe - it's your rollback option!
```

---

## 🚀 Migration Steps

### Step 1: Prepare New Codebase Locally

```bash
# On your macOS machine
cd /Users/teuteulilo/MyProjects/aba-stack-rev

# Verify frontend is built
ls -lh app/client/dist/

# If not built, build it now:
# cd app/client && npm install && npm run build && cd ../..

# Create deployment archive (excluding dev files)
tar -czf ../aba-stack-rev-deploy-$(date +%Y%m%d).tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='archive' \
  --exclude='.DS_Store' \
  --exclude='._*' \
  --exclude='app/backend/node_modules' \
  --exclude='app/client/node_modules' \
  .

# Verify archive
ls -lh ../aba-stack-rev-deploy-*.tar.gz
```

### Step 2: Transfer to Production Server

```bash
# From your macOS machine
# Replace 'user@prod-server' with actual SSH details

scp ../aba-stack-rev-deploy-$(date +%Y%m%d).tar.gz fmis@fs01.naurufinance.info:/tmp/

# Verify transfer
ssh fmis@fs01.naurufinance.info "ls -lh /tmp/aba-stack-rev-deploy-*.tar.gz"
```

### Step 3: Backup Current Production Code

```bash
# SSH into production server
ssh fmis@fs01.naurufinance.info

# Navigate to production stack location
cd /home/fmis/Stacks/aba-stack

# Create backup of current code
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
cd ..
tar -czf aba-stack-backup-${TIMESTAMP}.tar.gz aba-stack/

# Move backup to safe location
mv aba-stack-backup-${TIMESTAMP}.tar.gz /home/fmis/archive/

echo "Backup saved to: /home/fmis/archive/aba-stack-backup-${TIMESTAMP}.tar.gz"
```

### Step 4: Stop Current Services

```bash
# Still on production server
cd /home/fmis/Stacks/aba-stack

# Stop services but KEEP the database volume
docker compose down

# Verify containers stopped
docker ps | grep ron-aba

# IMPORTANT: Verify volume still exists
docker volume ls | grep pgdata

# Expected output: ron-stack_pgdata or similar - this contains your production data!
```

### Step 5: Extract New Code

```bash
# Still on production server
cd /home/fmis/Stacks/aba-stack

# Move old code aside (don't delete yet!)
mkdir -p ../aba-stack-old
mv * .* ../aba-stack-old/ 2>/dev/null || true

# Extract new code
tar -xzf /tmp/aba-stack-rev-deploy-*.tar.gz -C .

# Verify extraction
ls -la
```

### Step 6: Configure Environment

**CRITICAL: Match existing production configuration!**

```bash
# Still on production server
cd /home/fmis/Stacks/aba-stack

# Copy production credentials from old stack
cp ../aba-stack-old/.env.prod ./.env.prod

# Or manually edit .env.prod with correct values
nano .env.prod
```

**Must match existing production values:**
- ✅ `POSTGRES_PASSWORD` - **MUST** match existing database password
- ✅ `DB_PASSWORD` - same as POSTGRES_PASSWORD
- ✅ `JWT_SECRET` - keep existing to preserve user sessions
- ✅ `FRONTEND_BASE_URL` - production domain
- ✅ `SMTP_*` - existing email configuration
- ✅ Port mapping - production uses port `80` directly

**New values to verify:**
- `PORT=4000` (API port, internal)
- `DB_HOST=postgres` (container name)
- `DB_NAME=aba`
- `DB_USER=postgres`

### Step 7: Verify Volume Configuration

**Check docker-compose.yml volume section:**

```bash
# Still on production server
grep -A 5 "volumes:" docker-compose.yml | tail -6

# Should show:
# volumes:
#   ron-stack_pgdata:
#     external: false
```

**Check actual volume name in production:**

```bash
docker volume ls | grep pgdata

# If the volume name is different (e.g., ron-stack-prod_ron-stack_pgdata),
# you need to update docker-compose.yml to match!
```

**If volume names don't match, update docker-compose.yml:**

```bash
# Find the actual volume name
ACTUAL_VOLUME=$(docker volume ls | grep pgdata | awk '{print $2}')
echo "Actual volume: $ACTUAL_VOLUME"

# Edit docker-compose.yml to use the correct volume name
nano docker-compose.yml

# Change the volumes section to match, for example:
# volumes:
#   ron-stack-prod_ron-stack_pgdata:  # use actual name here
#     external: true                  # set to true if pre-existing
```

### Step 8: Start New Stack

```bash
# Still on production server
cd /home/fmis/Stacks/aba-stack

# Verify network exists
docker network ls | grep ron-net
# If missing: docker network create ron-net

# Start services with existing volume
docker compose up -d

# Watch startup logs
docker compose logs -f

# Wait for all containers to be healthy (30-60 seconds)
```

### Step 9: Verify Migration Success

**Run these checks:**

```bash
# 1. Check all containers are running
docker compose ps

# Expected: all 4 containers in "Up" state with (healthy)

# 2. Test health endpoint
curl http://localhost/health

# Expected: {"status":"ok"}

# 3. Verify database connectivity
docker exec -it ron-aba-postgres-prod psql -U postgres -d aba -c "
  SELECT COUNT(*) as reviewer_count FROM reviewers;
  SELECT COUNT(*) as batch_count FROM batch_archives;
"

# Should show your production data counts

# 4. Check backend logs
docker compose logs api | tail -50

# Look for:
# - "Database connected successfully"
# - "Server started on port 4000"
# - No error messages

# 5. Test web interface
curl -I http://localhost/

# Should return 200 OK

# 6. Check if static assets load
curl http://localhost/index.html | head -20
```

### Step 10: Test Critical Functions

**Open browser and test:**

1. **Frontend loads:** Navigate to `https://your-production-domain.com`
2. **Login works:** Try logging in with existing reviewer account
3. **Data visible:** Check "My Batches" shows existing submissions
4. **New batch:** Try creating a test batch (use draft mode)
5. **Reviewer access:** Login as reviewer, verify batches appear
6. **Admin panel:** Check admin can see users and settings

**If everything works:**

```bash
# Clean up
rm /tmp/aba-stack-rev-deploy-*.tar.gz
```

---

## 🔄 Rollback Procedure (If Needed)

If something goes wrong:

```bash
# Stop new stack
cd /home/fmis/Stacks/aba-stack
docker compose down

# Restore old code
cd /home/fmis/Stacks
rm -rf aba-stack
mv aba-stack-old aba-stack

# Start old stack
cd aba-stack
docker compose up -d

# Database is unchanged, so old code will work immediately

# If database was corrupted, restore from backup:
docker exec -i ron-aba-postgres-prod psql -U postgres -d aba < \
  /home/fmis/archive/aba-db-pre-migration-*.sql
```

---

## ⚠️ Important Considerations

### Frontend Path Change (CRITICAL!)

**Current production serves:** `./app/src` (raw HTML/CSS/JS files)  
**New stack serves:** `./app/client/dist` (built/optimized Vite output)

✅ **This is an improvement!** The new stack uses:
- Built and minified assets
- Optimized performance
- Better caching headers
- TypeScript compiled to JavaScript

**No action needed** - your `app/client/dist` is already built (verified Nov 27).

### Database Schema Updates

The new backend (`app/backend/src/db.js`) contains auto-migration logic:
- ✅ Creates missing tables
- ✅ Adds missing columns
- ✅ Creates missing indexes
- ✅ Idempotent (safe to run multiple times)

**On first startup**, the backend will:
1. Connect to existing database
2. Check for missing schema elements
3. Add any new tables/columns automatically
4. Preserve all existing data

### Volume Name Mismatch

**Common issue:** Docker Compose creates volumes with project name prefix

- Old stack: `ron-stack-prod_ron-stack_pgdata`
- New stack: `aba-stack-rev_ron-stack_pgdata`

**Solution:** Update `docker-compose.yml` to reference the actual volume name:

```yaml
volumes:
  postgres:
    volumes:
      - ron-stack_pgdata:/var/lib/postgresql/data  # or actual name

# At bottom of file:
volumes:
  ron-stack_pgdata:
    external: true  # ← Important! Tells Docker to use existing volume
```

### Port Conflicts

If you see "port already in use" errors:
```bash
# Check what's using the port
sudo lsof -i :80

# Production uses port 80 directly - ensure nothing else is using it
# If needed, stop conflicting service before migration
```

### Environment Variables

**Critical variables that must match production:**

| Variable | Why It Matters |
|----------|---------------|
| `POSTGRES_PASSWORD` | Must match existing DB or connection fails |
| `DB_PASSWORD` | Same as above, used by backend |
| `JWT_SECRET` | Changing invalidates all existing sessions |
| `SMTP_*` | Needed for email notifications |
| `FRONTEND_BASE_URL` | Used in email links and redirects |

### Windows SFTP Sync

If you're using the Windows SFTP sync service:
- Verify `WINDOWS_SYNC_URL` points to correct Windows server
- Test sync function after migration
- Check Windows service can reach new Docker containers

---

## 📊 Post-Migration Checklist

- [ ] All 4 containers running and healthy
- [ ] Health endpoint returns `{"status":"ok"}`
- [ ] Can login with existing accounts
- [ ] Existing batches visible in "My Batches"
- [ ] Reviewer dashboard shows pending batches
- [ ] Admin panel accessible
- [ ] New batch submission works
- [ ] Review workflow functions
- [ ] Email notifications working (test with signup request)
- [ ] SFTP sync triggers (if enabled)
- [ ] No errors in API logs: `docker compose logs api | grep -i error`
- [ ] No errors in browser console
- [ ] Old code backup saved in `/home/fmis/archive/`
- [ ] Database backup saved in `/home/fmis/archive/`
- [ ] Cleanup completed (tmp files removed)

---

## 🆘 Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs [service-name]

# Common issues:
# - Port already in use → check with: sudo lsof -i :9001
# - Volume permission issues → check with: docker volume inspect ron-stack_pgdata
# - Missing .env.prod → verify file exists and has correct values
```

### Database Connection Errors

```bash
# Test database directly
docker exec -it ron-aba-postgres-prod psql -U postgres -d aba

# If connection fails, check:
docker compose logs postgres

# Verify password in .env.prod matches
grep POSTGRES_PASSWORD .env.prod
grep DB_PASSWORD .env.prod
```

### API Returns 502 Bad Gateway

```bash
# Check backend health
docker exec -it ron-aba-backend-prod curl http://localhost:4000/health

# Check backend logs
docker compose logs api | tail -100

# Common causes:
# - Database connection failed (wrong password)
# - Backend crashed on startup
# - Port 4000 conflict inside container
```

### Data Missing After Migration

```bash
# Verify correct volume is mounted
docker inspect ron-aba-postgres-prod | grep -A 10 "Mounts"

# Should show: /var/lib/postgresql/data mounted from ron-stack_pgdata

# Check data inside volume
docker exec -it ron-aba-postgres-prod ls -la /var/lib/postgresql/data

# If wrong volume was used, stop stack and fix volume reference in docker-compose.yml
```

### Frontend Shows Old Version

```bash
# Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)

# Verify new files are served
docker exec -it ron-aba-generator-prod ls -la /usr/share/nginx/html/

# Check nginx config
docker exec -it ron-aba-generator-prod cat /etc/nginx/conf.d/default.conf

# Verify dist folder was copied correctly
ls -la app/client/dist/
```

---

## 📞 Quick Reference Commands

```bash
# View all logs
docker compose logs -f

# Restart specific service
docker compose restart api

# Check container health
docker compose ps

# Access database console
docker exec -it ron-aba-postgres-prod psql -U postgres -d aba

# View API logs only
docker compose logs -f api

# Check resource usage
docker stats

# List volumes
docker volume ls

# Inspect volume
docker volume inspect ron-stack_pgdata

# Test health endpoint
curl http://localhost/health

# Follow backend logs for errors
docker compose logs -f api | grep -i error
```

---

## ✅ Summary

**Migration Path:**
1. Backup current production (code + database) ✓
2. Stop current containers ✓
3. Replace code with new version ✓
4. Keep existing database volume ✓
5. Update configuration to match production ✓
6. Start new stack pointing to existing volume ✓
7. Verify data integrity ✓

**Expected Downtime:** 5-10 minutes  
**Data Loss Risk:** None (volume preserved, backup created)  
**Rollback Time:** 2-3 minutes (restart old code)

**The database volume is never deleted** - it persists between container restarts and code updates. Your production data is safe as long as you reference the correct volume name in docker-compose.yml!
