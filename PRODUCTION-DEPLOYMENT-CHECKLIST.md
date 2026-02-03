# Production Deployment Checklist for aba-stack-rev

**Last Updated:** December 9, 2025  
**Target Environment:** Production Server  
**Deployment Method:** Copy code + restore database

---

## ✅ Pre-Deployment Verification

### 1. Code Readiness
- ✅ **Frontend built:** `app/client/dist/` exists with compiled assets (verified Nov 27)
- ✅ **Backend ready:** `app/backend/src/` contains Node.js API server
- ✅ **Docker configs:** `docker-compose.yml` and `Dockerfile` are production-ready
- ✅ **Nginx config:** `app/docker/nginx.conf` properly routes `/` to static and `/api/` to backend

### 2. Configuration Files
- ✅ **`.env.prod` exists** in root directory
- ⚠️ **VERIFY** all sensitive values are set:
  - `POSTGRES_PASSWORD` (strong password)
  - `JWT_SECRET` (unique secret for this instance)
  - `DEFAULT_ADMIN_PASSWORD` (change after first login)
  - `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (for email notifications)
  - `WINDOWS_SYNC_URL` (if using SFTP sync)
  - `FRONTEND_BASE_URL` (production URL)

### 3. Database Backup
- ✅ **Latest backup:** `archive/aba-db-20251124-000001.sql` (Nov 24)
- ⚠️ **ACTION NEEDED:** Create fresh backup before deployment
- ✅ **Restore script:** `scripts/restore-db.sh` ready

### 4. Dependencies
- ✅ Backend `package.json` has all required dependencies
- ✅ Frontend built with Vite (production-optimized)
- ✅ No development-only dependencies in production images

---

## 📦 Deployment Steps

### Step 1: Prepare Production Server

```bash
```bash
# SSH into production server
ssh fmis@fs01.naurufinance.info

# Create directory structure
sudo mkdir -p /opt/ron-aba-stack
cd /opt/ron-aba-stack

# Ensure Docker is installed
docker --version
docker compose version

# Create external network (one-time setup)
docker network create ron-net
```

### Step 2: Transfer Files to Production

**From your local machine:**

```bash
# Navigate to the project
cd /Users/teuteulilo/MyProjects/aba-stack-rev

# Create deployment archive (excluding unnecessary files)
tar -czf ../aba-stack-rev-deploy.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='archive' \
  --exclude='.DS_Store' \
  --exclude='._*' \
  .

# Transfer to production server
scp ../aba-stack-rev-deploy.tar.gz user@production-server:/opt/ron-aba-stack/

# Transfer the database backup separately
scp archive/aba-db-20251124-000001.sql user@production-server:/opt/ron-aba-stack/
```

**On production server:**

```bash
cd /opt/ron-aba-stack
tar -xzf aba-stack-rev-deploy.tar.gz
rm aba-stack-rev-deploy.tar.gz

# Create archive directory and move SQL backup
mkdir -p archive
mv aba-db-20251124-000001.sql archive/
```

### Step 3: Configure Environment

```bash
# Verify .env.prod exists
ls -la .env.prod

# Review and update production values
nano .env.prod
```

**Critical values to verify:**
- Database passwords match between `POSTGRES_PASSWORD` and `DB_PASSWORD`
- `FRONTEND_BASE_URL` points to actual production domain
- SMTP credentials are correct
- JWT_SECRET is unique and secure
- Port `9001` is available (or change `PROD_WEB_PORT`)

### Step 4: Start the Stack

```bash
# Start services (this will create the database automatically)
docker compose up -d

# Verify containers are running
docker compose ps

# Check logs for any errors
docker compose logs -f
```

**Expected containers:**
- `ron-aba-postgres-prod` (PostgreSQL database)
- `ron-aba-backend-prod` (Express API)
- `ron-aba-generator-prod` (Nginx web server)
- `watchtower-ronstack` (auto-updates)

### Step 5: Restore Database

```bash
# Wait for Postgres to be fully ready (check health)
docker compose ps postgres

# Run restore script
chmod +x scripts/restore-db.sh
./scripts/restore-db.sh archive/aba-db-20251124-000001.sql
```

**Script will:**
1. Ask for confirmation
2. Drop existing schema
3. Restore from backup
4. Preserve all users, batches, and reviews

### Step 6: Verify Deployment

```bash
# Check health endpoint
curl http://localhost:9001/health

# Expected response: {"status":"ok"}

# Test API directly
docker exec -it ron-aba-backend-prod curl http://localhost:4000/health

# Check Postgres connection
docker exec -it ron-aba-postgres-prod psql -U postgres -d aba -c "SELECT COUNT(*) FROM reviewers;"
```

### Step 7: Firewall & Access

```bash
# Allow port 9001 (or configured PROD_WEB_PORT)
sudo ufw allow 9001/tcp
sudo ufw status

# If using reverse proxy (recommended), configure it to point to port 9001
# Example for Nginx reverse proxy:
# proxy_pass http://localhost:9001;
```

---

## 🔒 Post-Deployment Security

### Immediate Actions

1. **Change default admin password:**
   - Login at `https://your-domain.com` with credentials from `.env.prod`
   - Navigate to admin settings
   - Update password immediately

2. **Remove bootstrap credentials from `.env.prod`:**
   ```bash
   nano .env.prod
   # Comment out or remove these lines after first login:
   # DEFAULT_ADMIN_EMAIL=...
   # DEFAULT_ADMIN_PASSWORD=...
   ```

3. **Restart backend to clear env:**
   ```bash
   docker compose restart api
   ```

### Ongoing Security

- Rotate `JWT_SECRET` periodically (will invalidate existing sessions)
- Keep SMTP credentials secure
- Monitor logs for suspicious activity: `docker compose logs -f api`
- Ensure `.env.prod` has restrictive permissions: `chmod 600 .env.prod`

---

## 🔄 Backup Configuration

The production server should run automated backups:

**Backup script location:** `scripts/backup-ron-stack.sh`

**Setup cron job (as production user):**

```bash
# Edit crontab
crontab -e

# Add daily backup at midnight
0 0 * * * /opt/ron-aba-stack/scripts/backup-ron-stack.sh >> /opt/ron-aba-stack/scripts/backup-ron-stack-cron.log 2>&1
```

**Verify backup directory:**
```bash
ls -lh /home/fmis/archive/ | grep aba-db
```

**Backups include:**
- Database SQL dump (`.sql`)
- Docker volume archives (`.tar.gz`)
- Repository snapshots
- Retained for 15 days by default

---

## 🚨 Rollback Procedure

If deployment fails or issues arise:

```bash
# Stop new containers
docker compose down

# Restore previous backup if needed
./scripts/restore-db.sh /path/to/previous-backup.sql

# Revert to previous code version
# (keep previous deployment as backup before overwriting)

# Restart services
docker compose up -d
```

---

## 📊 Monitoring & Health Checks

### Health Endpoints

- **Application:** `http://localhost:9001/health`
- **API Direct:** `http://localhost:4000/health` (internal)
- **Database:** Via `docker exec` commands

### Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f web
docker compose logs -f postgres

# Backend application logs
docker exec -it ron-aba-backend-prod cat /app/logs/app.log
```

### Resource Monitoring

```bash
# Container resource usage
docker stats

# Disk usage
df -h
docker system df
```

---

## ⚠️ Known Considerations

### 1. Client Build
- ✅ Frontend is pre-built in `app/client/dist/`
- If you make frontend changes, rebuild before deploying:
  ```bash
  cd app/client
  npm install
  npm run build
  ```

### 2. Database Schema
- ✅ Backend auto-initializes schema on first run (`src/db.js`)
- ✅ Restoring from backup will overwrite with production data
- Migration is idempotent and safe

### 3. SFTP Sync Integration
- If using Windows SFTP sync service, ensure:
  - `SFTP_SYNC_METHOD=direct` in `.env.prod`
  - `WINDOWS_SYNC_URL` points to Windows service
  - Windows service is running and accessible from Docker container
  - See `SFTP_SYNC_INTEGRATION.md` for detailed setup

### 4. Email Notifications
- Requires valid SMTP configuration
- If SMTP is not configured, emails fail gracefully
- Use port 587 with `SMTP_SECURE=false` for STARTTLS

### 5. Watchtower Auto-Updates
- Only updates containers with label: `com.centurylinklabs.watchtower.enable=true`
- Can be disabled by removing the watchtower service from `docker-compose.yml`
- Runs daily cleanup of old images

---

## ✅ Final Verification Checklist

Before declaring deployment successful:

- [ ] All 4 containers running (`docker compose ps`)
- [ ] Health endpoint returns `{"status":"ok"}`
- [ ] Can login with admin credentials
- [ ] Database contains expected data (check reviewer count, batch count)
- [ ] Static assets load correctly (check browser console)
- [ ] API responds to authenticated requests
- [ ] Email notifications work (test signup request)
- [ ] SFTP sync triggers (if enabled)
- [ ] Backup cron job configured
- [ ] Firewall rules applied
- [ ] Default admin password changed
- [ ] `.env.prod` permissions secured (`600`)
- [ ] Documentation updated with production URLs

---

## 📞 Support & Troubleshooting

### Common Issues

**Container won't start:**
```bash
docker compose logs [service-name]
```

**Database connection errors:**
- Verify `DB_HOST=postgres` in `.env.prod`
- Check `POSTGRES_PASSWORD` matches `DB_PASSWORD`
- Ensure postgres container is healthy: `docker compose ps postgres`

**Frontend shows 502 Bad Gateway:**
- Check API container logs: `docker compose logs api`
- Verify nginx config: `docker exec -it ron-aba-generator-prod cat /etc/nginx/conf.d/default.conf`
- Test API directly: `curl http://localhost:4000/health`

**Can't access from external network:**
- Check firewall: `sudo ufw status`
- Verify port binding: `netstat -tulpn | grep 9001`
- Check reverse proxy configuration (if used)

### Quick Commands Reference

```bash
# Restart all services
docker compose restart

# Rebuild and restart specific service
docker compose up -d --build api

# View real-time logs
docker compose logs -f --tail=100

# Execute command in container
docker exec -it ron-aba-backend-prod sh

# Database console
docker exec -it ron-aba-postgres-prod psql -U postgres -d aba

# Force recreate all containers
docker compose up -d --force-recreate
```

---

## Summary

**Your `aba-stack-rev` is production-ready!**

✅ **Frontend:** Built and optimized in `dist/`  
✅ **Backend:** Production Dockerfile with Node 20  
✅ **Database:** PostgreSQL with auto-initialization  
✅ **Configuration:** `.env.prod` template exists  
✅ **Deployment:** Simple copy + restore workflow  
✅ **Backups:** Scripts and automation ready  
✅ **Documentation:** Comprehensive README and guides  

**Deployment Time:** ~15-30 minutes  
**Downtime Required:** None (fresh deployment) or ~5 minutes (if replacing existing)

**Next Steps:**
1. Create fresh database backup before deploying
2. Transfer files to production server
3. Configure `.env.prod` with production values
4. Start stack with `docker compose up -d`
5. Restore database with `restore-db.sh`
6. Verify health and change admin password
