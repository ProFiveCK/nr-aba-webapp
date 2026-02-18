#!/bin/bash

# Production Backup and Monitoring Script
# Runs database backups and checks for backend crashes.
#
# Defaults:
# - Backups are written to: <repo>/archive
# - Log file: <repo>/backup-monitor.log
#
# Override via env vars:
# - BACKUP_DIR
# - LOG_FILE
# - MAX_BACKUPS

set -e

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

BACKUP_DIR=${BACKUP_DIR:-"$PROJECT_ROOT/archive"}
LOG_FILE=${LOG_FILE:-"$PROJECT_ROOT/backup-monitor.log"}
MAX_BACKUPS=${MAX_BACKUPS:-14}  # Keep 2 weeks of daily backups

mkdir -p "$BACKUP_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 1. Create database backup
backup_database() {
    log "Starting database backup..."
    BACKUP_FILE="$BACKUP_DIR/aba-db-$(date +%Y%m%d-%H%M%S).sql"
    
    if docker exec ron-aba-postgres-prod pg_dump -U postgres aba > "$BACKUP_FILE" 2>&1; then
        log "✅ Backup created: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
        
        # Cleanup old backups
        BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/aba-db-*.sql 2>/dev/null | wc -l)
        if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
            OLD_BACKUPS=$(ls -1t "$BACKUP_DIR"/aba-db-*.sql | tail -n +$((MAX_BACKUPS + 1)))
            echo "$OLD_BACKUPS" | xargs rm -f
            log "🗑️  Cleaned up $((BACKUP_COUNT - MAX_BACKUPS)) old backups"
        fi
    else
        log "❌ Backup failed!"
        return 1
    fi
}

# 2. Check backend health
check_backend_health() {
    log "Checking backend health..."
    
    # Check if container is running
    if ! docker ps --filter "name=ron-aba-backend-prod" --format "{{.Status}}" | grep -q "Up"; then
        log "⚠️  Backend container is not running!"
        
        # Check if it's restarting (crash loop)
        if docker ps -a --filter "name=ron-aba-backend-prod" --format "{{.Status}}" | grep -q "Restarting"; then
            log "🔥 Backend is in crash loop - checking logs..."
            docker logs ron-aba-backend-prod --tail 50 2>&1 | grep -E "ERROR|FATAL|Failed" >> "$LOG_FILE"
            
            # Alert: In production, send email/SMS here
            log "⚠️  ALERT: Backend crash detected - manual intervention required"
            return 1
        fi
    fi
    
    # Check if API responds
    if docker exec ron-aba-backend-prod node -e "require('http').get('http://localhost:4000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" 2>/dev/null; then
        log "✅ Backend is healthy"
        return 0
    else
        log "⚠️  Backend health endpoint not responding"
        return 1
    fi
}

# 3. Check for database corruption
check_database_corruption() {
    log "Checking for database corruption..."
    
    CORRUPT=$(docker exec ron-aba-postgres-prod psql -U postgres -d aba -t -c "
        SELECT COUNT(*) FROM pg_constraint 
        WHERE pg_get_constraintdef(oid) = '' OR pg_get_constraintdef(oid) IS NULL;
    " 2>&1)
    
    if [ "$CORRUPT" -gt 0 ]; then
        log "🔥 Database corruption detected: $CORRUPT corrupted constraints"
        log "⚠️  CRITICAL: Restore from latest backup immediately"
        return 1
    fi
    
    log "✅ No database corruption detected"
    return 0
}

# Main execution
log "========================================"
log "Production Health Check and Backup"
log "========================================"

# Run checks
backup_database
check_backend_health
check_database_corruption

log "========================================"
log "Monitoring cycle complete"
log "========================================"
