#!/usr/bin/env bash
set -euo pipefail

# backup-ron-stack.sh
# Creates a repo snapshot, backs up the Postgres volume, and writes a logical DB dump.
#
# Defaults:
# - Archives are written to: <repo>/archive
# - Prunes archives older than: 15 days
#
# You can override locations via env vars:
# - ARCHIVE_DIR
# - POSTGRES_CONTAINER (default: ron-aba-postgres-prod)
# - POSTGRES_DB (default: aba)
# - POSTGRES_USER (default: postgres)

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)

ARCHIVE_DIR=${ARCHIVE_DIR:-"$PROJECT_ROOT/archive"}
POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-ron-aba-postgres-prod}
POSTGRES_DB=${POSTGRES_DB:-aba}
POSTGRES_USER=${POSTGRES_USER:-postgres}

LOCKFILE=${LOCKFILE:-"$ARCHIVE_DIR/.backup_ron_stack.lock"}
exec 9>"$LOCKFILE"
if ! command -v flock >/dev/null 2>&1; then
  echo "flock not available; proceeding without lock (risk of overlapping runs)"
else
  if ! flock -n 9; then
    echo "Another backup is running, exiting"
    exit 0
  fi
fi

TS=$(date +%Y%m%d-%H%M%S)
LOG=$ARCHIVE_DIR/backup-$TS.log
mkdir -p "$ARCHIVE_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting backup $TS" | tee -a "$LOG"

# 1) archive repo folder
echo "Archiving $PROJECT_ROOT to $ARCHIVE_DIR/aba-stack-$TS.tar.gz" | tee -a "$LOG"
if tar -czf "$ARCHIVE_DIR/aba-stack-$TS.tar.gz" \
  --exclude='archive' \
  --exclude='node_modules' \
  --exclude='**/node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.prod' \
  -C "$PROJECT_ROOT" . >> "$LOG" 2>&1; then
  echo "Archive created" | tee -a "$LOG"
else
  echo "Archive failed" | tee -a "$LOG"
fi

# 2) backup pgdata docker volume
if docker volume inspect ron-stack_pgdata >/dev/null 2>&1; then
  VOL=ron-stack_pgdata
else
  VOL=$(docker volume ls --format '{{.Name}}' | grep -i pgdata | head -n1 || true)
fi
if [ -n "$VOL" ]; then
  echo "Backing up volume $VOL to $ARCHIVE_DIR/${VOL}-pgdata-$TS.tar.gz" | tee -a "$LOG"
  if docker run --rm -v ${VOL}:/data -v "$ARCHIVE_DIR":/backup alpine sh -c "cd /data && tar czf /backup/${VOL}-pgdata-$TS.tar.gz ." >> "$LOG" 2>&1; then
    echo "Volume backup created" | tee -a "$LOG"
  else
    echo "Volume backup failed" | tee -a "$LOG"
  fi
else
  echo "No pgdata volume found; skipping volume backup" | tee -a "$LOG"
fi

# 3) SQL dump from running postgres container
if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
  echo "Dumping Postgres DB '$POSTGRES_DB' to $ARCHIVE_DIR/aba-db-$TS.sql" | tee -a "$LOG"
  if docker exec -i "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$ARCHIVE_DIR/aba-db-$TS.sql" 2>>"$LOG"; then
    echo "SQL dump created" | tee -a "$LOG"
  else
    echo "SQL dump failed" | tee -a "$LOG"
  fi
else
  echo "Postgres container '$POSTGRES_CONTAINER' not running; skipping SQL dump" | tee -a "$LOG"
fi

# 4) prune files older than 15 days
echo "Pruning files older than 15 days in $ARCHIVE_DIR" | tee -a "$LOG"
find "$ARCHIVE_DIR" -type f -mtime +15 -print -delete >> "$LOG" 2>&1 || true

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup finished" | tee -a "$LOG"

# release lock by exiting (file descriptor closed)
exit 0
