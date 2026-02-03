#!/usr/bin/env bash
set -euo pipefail

# backup-ron-stack.sh
# Creates an archive of ron-stack-rev, backs up Postgres volume and DB dump,
# stores artifacts in /home/fmis/archive, and prunes files older than 15 days.

LOCKFILE=/home/fmis/.backup_ron_stack.lock
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
ARCHIVE_DIR=/home/fmis/Stacks/aba-stack/archive
WORK_DIR=/home/fmis/Stacks
SRC_DIR=$WORK_DIR/aba-stack
LOG=$ARCHIVE_DIR/backup-$TS.log
mkdir -p "$ARCHIVE_DIR"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting backup $TS" | tee -a "$LOG"

# 1) archive repo folder
echo "Archiving $SRC_DIR to $ARCHIVE_DIR/aba-stack-$TS.tar.gz" | tee -a "$LOG"
if tar -czf "$ARCHIVE_DIR/aba-stack-$TS.tar.gz" --exclude='archive' -C "$WORK_DIR" "$(basename "$SRC_DIR")" >> "$LOG" 2>&1; then
  echo "Archive created" | tee -a "$LOG"
else
  echo "Archive failed" | tee -a "$LOG"
fi

# 2) backup pgdata docker volume (first match)
VOL=$(docker volume ls --format '{{.Name}}' | grep -i pgdata | head -n1 || true)
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
if docker ps --format '{{.Names}}' | grep -q '^ron-aba-postgres-prod$'; then
  echo "Dumping Postgres DB 'aba' to $ARCHIVE_DIR/aba-db-$TS.sql" | tee -a "$LOG"
  if docker exec -i ron-aba-postgres-prod sh -c 'export PGPASSWORD="G7!xP@2vQz#1sL9w"; pg_dump -U postgres aba' > "$ARCHIVE_DIR/aba-db-$TS.sql" 2>>"$LOG"; then
    echo "SQL dump created" | tee -a "$LOG"
  else
    echo "SQL dump failed" | tee -a "$LOG"
  fi
else
  echo "Postgres container 'ron-aba-postgres-prod' not running; skipping SQL dump" | tee -a "$LOG"
fi

# 4) prune files older than 15 days
echo "Pruning files older than 15 days in $ARCHIVE_DIR" | tee -a "$LOG"
find "$ARCHIVE_DIR" -type f -mtime +15 -print -delete >> "$LOG" 2>&1 || true

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup finished" | tee -a "$LOG"

# release lock by exiting (file descriptor closed)
exit 0
