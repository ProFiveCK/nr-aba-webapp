#!/bin/bash
set -e

# restore-database.sh
# Restores database to work with the existing nr-aba-webapp application
# Handles both SQL dumps and the case where no database backup exists

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTAINER_NAME="ron-aba-postgres-prod"
DB_USER="postgres"
DB_NAME="aba"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║        ABA Database Restoration Script                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if Docker is running
if ! docker ps &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not running. Please start Docker Desktop first.${NC}"
    echo "Run: open -a Docker"
    exit 1
fi

# Check if container exists
if ! docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${RED}ERROR: Container ${CONTAINER_NAME} not found.${NC}"
    echo "Please start your docker-compose stack first:"
    echo "  cd $PROJECT_ROOT && docker-compose up -d"
    exit 1
fi

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo -e "${YELLOW}Container ${CONTAINER_NAME} is not running. Starting it...${NC}"
    cd "$PROJECT_ROOT" && docker-compose up -d postgres
    echo "Waiting for database to be ready..."
    sleep 5
fi

# Look for SQL dumps
echo "Searching for database backups..."
SQL_FILES=()

# Check backup folder
if compgen -G "$SCRIPT_DIR/*.sql" > /dev/null; then
    while IFS= read -r file; do
        SQL_FILES+=("$file")
    done < <(ls -t "$SCRIPT_DIR"/*.sql 2>/dev/null)
fi

# Check archive folders in parent directories
ARCHIVE_DIRS=(
    "$PROJECT_ROOT/archive"
    "$PROJECT_ROOT/../archive/aba-stack-rev/archive"
    "$PROJECT_ROOT/../archive/aba-stack-dev/archive"
    "/Users/teuteulilo/MyProjects/archive"
)

for dir in "${ARCHIVE_DIRS[@]}"; do
    if [ -d "$dir" ]; then
        if compgen -G "$dir/aba-db*.sql" > /dev/null; then
            while IFS= read -r file; do
                SQL_FILES+=("$file")
            done < <(ls -t "$dir"/aba-db*.sql 2>/dev/null)
        fi
    fi
done

# Remove duplicates and sort by modification time
if [ ${#SQL_FILES[@]} -gt 0 ]; then
    TEMP_FILES=()
    while IFS= read -r file; do
        TEMP_FILES+=("$file")
    done < <(printf '%s\n' "${SQL_FILES[@]}" | sort -u)
    SQL_FILES=("${TEMP_FILES[@]}")
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "Database Restoration Options:"
echo "════════════════════════════════════════════════════════════════"
echo ""

if [ ${#SQL_FILES[@]} -eq 0 ]; then
    echo -e "${YELLOW}⚠ No SQL database dumps found in:${NC}"
    echo "  - $SCRIPT_DIR"
    echo "  - Archive directories"
    echo ""
    echo -e "${GREEN}Your current database will remain unchanged.${NC}"
    echo "This is likely what you want since:"
    echo "  • Your application code will be updated from the backup"
    echo "  • Your existing database (with current admin user) stays intact"
    echo "  • No data loss occurs"
    echo ""
    echo -e "${YELLOW}If you have a separate SQL dump file, you can restore it with:${NC}"
    echo "  $0 <path-to-sql-dump>"
    exit 0
fi

echo "Found ${#SQL_FILES[@]} SQL backup file(s):"
echo ""

for i in "${!SQL_FILES[@]}"; do
    file="${SQL_FILES[$i]}"
    size=$(ls -lh "$file" | awk '{print $5}')
    date=$(ls -l "$file" | awk '{print $6, $7, $8}')
    echo "  [$i] $(basename "$file")"
    echo "      Size: $size, Modified: $date"
    echo "      Path: $file"
    echo ""
done

echo "  [s] Skip database restore (keep current database)"
echo "  [c] Provide custom SQL file path"
echo "  [q] Quit"
echo ""

# Get user choice
read -p "Select option: " choice

case $choice in
    [0-9]*)
        if [ "$choice" -ge 0 ] && [ "$choice" -lt "${#SQL_FILES[@]}" ]; then
            BACKUP_FILE="${SQL_FILES[$choice]}"
        else
            echo -e "${RED}Invalid selection${NC}"
            exit 1
        fi
        ;;
    s|S)
        echo -e "${GREEN}Keeping current database. No changes made.${NC}"
        exit 0
        ;;
    c|C)
        read -p "Enter path to SQL file: " BACKUP_FILE
        if [ ! -f "$BACKUP_FILE" ]; then
            echo -e "${RED}File not found: $BACKUP_FILE${NC}"
            exit 1
        fi
        ;;
    q|Q)
        echo "Cancelled."
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid option${NC}"
        exit 1
        ;;
esac

echo ""
echo "════════════════════════════════════════════════════════════════"
echo -e "${YELLOW}⚠  WARNING ⚠${NC}"
echo "════════════════════════════════════════════════════════════════"
echo "You are about to restore from:"
echo "  $BACKUP_FILE"
echo ""
echo "This will:"
echo "  • DROP ALL existing data in the '$DB_NAME' database"
echo "  • Restore data from the backup file"
echo "  • Replace your current admin user with the one from backup"
echo ""
echo -e "${RED}This action CANNOT be undone!${NC}"
echo ""

# Offer to backup current database first
read -p "Do you want to backup your CURRENT database first? (Y/n): " backup_current
if [[ ! "$backup_current" =~ ^[nN]$ ]]; then
    CURRENT_BACKUP="$SCRIPT_DIR/current-db-backup-$(date +%Y%m%d-%H%M%S).sql"
    echo "Backing up current database to:"
    echo "  $CURRENT_BACKUP"
    
    if docker exec -i "$CONTAINER_NAME" sh -c "pg_dump -U $DB_USER $DB_NAME" > "$CURRENT_BACKUP" 2>/dev/null; then
        echo -e "${GREEN}✓ Current database backed up successfully${NC}"
    else
        echo -e "${RED}✗ Failed to backup current database${NC}"
        read -p "Continue anyway? (y/N): " continue_anyway
        if [[ ! "$continue_anyway" =~ ^[yY]$ ]]; then
            exit 1
        fi
    fi
    echo ""
fi

# Final confirmation
read -p "Proceed with database restore? (yes/no): " final_confirm
if [[ ! "$final_confirm" =~ ^([yY][eE][sS]|[yY])$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "Starting Database Restore..."
echo "════════════════════════════════════════════════════════════════"

# Step 1: Drop existing schema
echo ""
echo "Step 1/3: Dropping existing database schema..."
if docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" &> /dev/null; then
    echo -e "${GREEN}✓ Schema dropped successfully${NC}"
else
    echo -e "${RED}✗ Failed to drop schema${NC}"
    exit 1
fi

# Step 2: Restore from backup
echo ""
echo "Step 2/3: Restoring from backup file..."
echo "  (This may take a few moments...)"
if cat "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" &> /dev/null; then
    echo -e "${GREEN}✓ Database restored successfully${NC}"
else
    echo -e "${RED}✗ Failed to restore database${NC}"
    echo "You may need to restore from your backup: $CURRENT_BACKUP"
    exit 1
fi

# Step 3: Verify restoration
echo ""
echo "Step 3/3: Verifying database..."
USER_COUNT=$(docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM users;" 2>/dev/null | tr -d ' ')
ADMIN_COUNT=$(docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM users WHERE role='admin';" 2>/dev/null | tr -d ' ')

if [ -n "$USER_COUNT" ]; then
    echo -e "${GREEN}✓ Database is operational${NC}"
    echo "  Total users: $USER_COUNT"
    echo "  Admin users: $ADMIN_COUNT"
else
    echo -e "${YELLOW}⚠ Could not verify user count (table might not exist)${NC}"
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo -e "${GREEN}✓ Database Restoration Complete!${NC}"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Restart your application: cd $PROJECT_ROOT && docker-compose restart api"
echo "  2. Test login with the admin credentials from the backup"
echo "  3. If you need to reset admin password, run:"
echo "     docker exec -it $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME"
echo ""

# Show admin users if available
echo "Admin users in restored database:"
docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT id, username, role, created_at FROM users WHERE role='admin' ORDER BY id;" 2>/dev/null || echo "  (Could not retrieve admin users)"

echo ""
echo "═══════════════════════════════════════════════════════════════"
