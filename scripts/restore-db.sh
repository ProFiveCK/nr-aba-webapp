#!/bin/bash
set -e

# Configuration
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
ARCHIVE_DIR="$SCRIPT_DIR/../archive"
CONTAINER_NAME="ron-aba-postgres-prod"
DB_USER="postgres"
DB_NAME="aba"

# Function to print usage
usage() {
    echo "Usage: $0 [path_to_sql_dump]"
    echo "If no file is specified, the latest .sql file in $ARCHIVE_DIR will be used."
    exit 1
}

# Determine input file
if [ -n "$1" ]; then
    BACKUP_FILE="$1"
else
    # Find latest SQL dump
    BACKUP_FILE=$(ls -t "$ARCHIVE_DIR"/*.sql 2>/dev/null | head -n 1)
fi

# Check if file exists
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file not found."
    if [ -z "$1" ]; then
        echo "No .sql files found in $ARCHIVE_DIR"
    else
        echo "File: $1"
    fi
    exit 1
fi

echo "=== Database Restore Tool ==="
echo "Target Container: $CONTAINER_NAME"
echo "Backup File:      $BACKUP_FILE"
echo ""
echo "WARNING: This will WIPE ALL DATA in the '$DB_NAME' database and restore from the backup."
echo "Are you sure you want to proceed? (y/N)"
read -r response

if [[ ! "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "Step 1: Wiping existing database..."
docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "Step 2: Restoring from backup..."
cat "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME"

echo ""
echo "Restore complete!"
