# Ready to Deploy! ✅

Your `aba-stack-rev` is now configured to deploy to production server `nrfmis03`.

## What's Been Done

1. ✅ **docker-compose.yml updated** to match production:
   - Port changed from `9001` to `80` (matches production)
   - Volume set to `external: true` (will reuse existing data)
   - All container names match production

2. ✅ **Migration guide created** with production specifics:
   - Server: `fmis@nrfmis03`
   - Path: `/home/fmis/Stacks/aba-stack`
   - Volume: `ron-stack_pgdata` (external, preserved)
   - Network: `ron-net` (external)

3. ✅ **Automated deployment script** created: `deploy-to-production.sh`

## Key Configuration Differences

| Item | Current Production | New Stack | Status |
|------|-------------------|-----------|---------|
| Frontend | `./app/src` (raw files) | `./app/client/dist` (built) | ✅ Improved |
| Port | 80 | 80 | ✅ Matched |
| Database Volume | `ron-stack_pgdata` (external) | Same volume reused | ✅ Preserved |
| Container Names | ron-aba-* | Same | ✅ Matched |

## Deployment Options

### Option 1: Automated Deployment (Recommended)

```bash
cd /Users/teuteulilo/MyProjects/aba-stack-rev
./deploy-to-production.sh
```

**What it does:**
1. Creates deployment archive
2. Transfers to production server
3. Backs up current code & database
4. Stops old containers
5. Extracts new code
6. Copies `.env.prod` from old stack
7. Starts new stack
8. Verifies health

**Time:** ~5 minutes  
**Downtime:** ~2-3 minutes

### Option 2: Manual Deployment

Follow the step-by-step guide in: `PRODUCTION-MIGRATION-GUIDE.md`

## Pre-Deployment Checklist

- [x] Frontend built: `app/client/dist/` exists
- [x] Backend ready: `app/backend/src/` complete
- [x] docker-compose.yml matches production
- [ ] Verify SSH access: `ssh fmis@fs01.naurufinance.info`
- [ ] Confirm production URL: https://aba.naurufinance.info
- [ ] Test locally if needed: `docker compose up -d`

## Production Database

**IMPORTANT:** Your production database will be **preserved**!

- Volume: `ron-stack_pgdata` (external)
- Contains: All users, batches, reviews, history
- Backup: Created automatically during deployment
- Schema: Auto-migrates on startup (adds new tables/columns)

## What Happens During Deployment

1. **Backup Phase** (1 min)
   - Database dump: `/home/fmis/archive/aba-db-pre-migration-*.sql`
   - Code backup: `/home/fmis/archive/aba-stack-backup-*.tar.gz`

2. **Stop Phase** (30 sec)
   - Containers stopped
   - Volume preserved
   - Network remains

3. **Deploy Phase** (2 min)
   - Old code moved to `../aba-stack-old`
   - New code extracted
   - `.env.prod` copied from old stack
   - Containers started with existing volume

4. **Verify Phase** (1 min)
   - Health check
   - Database connectivity
   - Container status

## Rollback Plan

If anything goes wrong:

```bash
ssh fmis@fs01.naurufinance.info
cd /home/fmis/Stacks/aba-stack
docker compose down
cd ..
rm -rf aba-stack
mv aba-stack-old aba-stack
cd aba-stack
docker compose up -d
```

**Time:** 2-3 minutes  
**Data loss:** None (volume never touched)

## Post-Deployment Testing

1. Access: https://aba.naurufinance.info
2. Login with existing reviewer account
3. Check "My Batches" - should show existing data
4. Create test batch (use draft mode)
5. Login as reviewer - verify workflow
6. Check admin panel - users and settings
7. Test SFTP sync (if enabled)

## Important Files

- `PRODUCTION-MIGRATION-GUIDE.md` - Complete manual instructions
- `deploy-to-production.sh` - Automated deployment script
- `docker-compose.yml` - Production-ready configuration
- `.env.prod` - Environment config (copy from production)

## Environment Variables

**Must match production:**
- `POSTGRES_PASSWORD` - Database password
- `DB_PASSWORD` - Same as above
- `JWT_SECRET` - Keep same to preserve sessions
- `SMTP_*` - Email configuration
- `FRONTEND_BASE_URL` - https://aba.naurufinance.info

## Support

### Quick Commands

```bash
# Check deployment status
ssh fmis@fs01.naurufinance.info "cd /home/fmis/Stacks/aba-stack && docker compose ps"

# View logs
ssh fmis@fs01.naurufinance.info "cd /home/fmis/Stacks/aba-stack && docker compose logs -f api"

# Check database
ssh fmis@fs01.naurufinance.info "docker exec -it ron-aba-postgres-prod psql -U postgres -d aba -c 'SELECT COUNT(*) FROM reviewers;'"

# Test health
ssh fmis@fs01.naurufinance.info "curl http://localhost/health"
```

### Common Issues

**Port 80 in use:**
```bash
ssh fmis@fs01.naurufinance.info "sudo lsof -i :80"
# Stop conflicting service before deployment
```

**Database connection failed:**
- Verify `POSTGRES_PASSWORD` in `.env.prod` matches existing database
- Check: `docker compose logs postgres`

**Frontend shows old version:**
- Clear browser cache: Cmd+Shift+R
- Verify `app/client/dist/` was included in deployment

## Ready to Deploy?

1. **Test SSH access:**
   ```bash
   ssh fmis@fs01.naurufinance.info "docker ps"
   ```

2. **Run deployment:**
   ```bash
   cd /Users/teuteulilo/MyProjects/aba-stack-rev
   ./deploy-to-production.sh
   ```

3. **Monitor progress** - script will show each step

4. **Test application** when complete

5. **Celebrate!** 🎉

---

**Estimated Total Time:** 10-15 minutes  
**Actual Downtime:** 2-3 minutes  
**Risk Level:** Low (backups created, easy rollback)  
**Data Loss Risk:** None (volume preserved)
