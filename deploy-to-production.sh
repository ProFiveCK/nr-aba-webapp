#!/bin/bash
set -e

# RON ABA Stack - Production Deployment Script
# Date: December 9, 2025

echo "=========================================="
echo "  RON ABA Stack - Production Deployment"
echo "=========================================="
echo ""

# Configuration
# Set these via environment variables before running:
#   PROD_SERVER=user@your-server
#   PROD_PATH=/opt/aba-stack
#
# Optional:
#   LOCAL_PATH=/path/to/aba-stack

PROD_SERVER=${PROD_SERVER:-"user@your-server"}
PROD_PATH=${PROD_PATH:-"/opt/aba-stack"}
LOCAL_PATH=${LOCAL_PATH:-"$(pwd)"}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE_NAME="aba-stack-deploy-$(date +%Y%m%d).tar.gz"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Step 1: Pre-flight checks${NC}"
echo "Checking local build..."

if [ "$PROD_SERVER" = "user@your-server" ]; then
    echo -e "${RED}ERROR: Set PROD_SERVER (e.g. user@host) before running.${NC}"
    exit 1
fi

# Check if dist exists
if [ ! -d "$LOCAL_PATH/app/client/dist" ]; then
    echo -e "${RED}ERROR: Frontend not built! Run: cd app/client && npm run build${NC}"
    exit 1
fi

if [ ! -f "$LOCAL_PATH/.env.prod" ]; then
    echo -e "${YELLOW}WARNING: .env.prod not found locally. Will copy from production.${NC}"
fi

echo -e "${GREEN}✓ Local checks passed${NC}"
echo ""

# Confirm production details
echo -e "${YELLOW}Production Server Details:${NC}"
echo "  Server: $PROD_SERVER"
echo "  Path: $PROD_PATH"
echo "  Archive: $ARCHIVE_NAME"
echo ""

read -p "Continue with deployment? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 0
fi

echo ""
echo -e "${YELLOW}Step 2: Creating deployment archive${NC}"

# Create archive
cd "$LOCAL_PATH"
tar -czf "../${ARCHIVE_NAME}" \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='archive' \
  --exclude='.DS_Store' \
  --exclude='._*' \
  --exclude='app/backend/node_modules' \
  --exclude='app/client/node_modules' \
  .

if [ ! -f "../${ARCHIVE_NAME}" ]; then
    echo -e "${RED}ERROR: Failed to create archive${NC}"
    exit 1
fi

ARCHIVE_SIZE=$(ls -lh "../${ARCHIVE_NAME}" | awk '{print $5}')
echo -e "${GREEN}✓ Archive created: ${ARCHIVE_SIZE}${NC}"
echo ""

echo -e "${YELLOW}Step 3: Transferring to production${NC}"

# Transfer archive
scp "../${ARCHIVE_NAME}" "${PROD_SERVER}:/tmp/"
if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Failed to transfer archive${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Transfer complete${NC}"
echo ""

echo -e "${YELLOW}Step 4: Creating production backups${NC}"

# Execute backup commands on production
ssh "$PROD_SERVER" "PROD_PATH='$PROD_PATH' bash -s" << 'ENDSSH'
set -e

TIMESTAMP=$(date +%Y%m%d-%H%M%S)

if [ -z "${PROD_PATH:-}" ]; then
    echo "PROD_PATH is not set on the remote session"
    exit 1
fi

echo "Creating archive directory..."
mkdir -p "$PROD_PATH/archive"

echo "Backing up database..."
docker exec ron-aba-postgres-prod pg_dump -U postgres aba > \
    "$PROD_PATH/archive/aba-db-pre-migration-${TIMESTAMP}.sql"

echo "Backing up current code..."
tar -czf "$PROD_PATH/archive/aba-stack-backup-${TIMESTAMP}.tar.gz" --exclude='archive' -C "$(dirname "$PROD_PATH")" "$(basename "$PROD_PATH")"

echo "Backups created:"
ls -lh "$PROD_PATH/archive/aba-db-pre-migration-${TIMESTAMP}.sql"
ls -lh "$PROD_PATH/archive/aba-stack-backup-${TIMESTAMP}.tar.gz"
ENDSSH

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Backup failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Backups complete${NC}"
echo ""

echo -e "${YELLOW}Step 5: Deploying new code${NC}"

# Deploy on production
ssh "$PROD_SERVER" "PROD_PATH='$PROD_PATH' bash -s" << 'ENDSSH'
set -e

TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "Stopping services..."
cd "$PROD_PATH"
docker compose down

echo "Verifying volume exists..."
docker volume ls | grep ron-stack_pgdata

echo "Moving old code..."
cd "$(dirname "$PROD_PATH")"
OLD_DIR="$(basename "$PROD_PATH")-old-$TIMESTAMP"
mkdir -p "$OLD_DIR"
cd "$(basename "$PROD_PATH")"
shopt -s dotglob
mv * "../$OLD_DIR/" 2>/dev/null || true

echo "Extracting new code..."
cd "$PROD_PATH"
tar -xzf "/tmp/${ARCHIVE_NAME}"

echo "Copying production environment..."
if [ -f "../$OLD_DIR/.env.prod" ]; then
    cp "../$OLD_DIR/.env.prod" ./.env.prod
else
    echo "WARNING: No previous .env.prod found to copy; ensure .env.prod is configured."
fi

echo "Starting new stack..."
docker network ls | grep -q ron-net || docker network create ron-net
docker compose up -d

echo "Waiting for services to start..."
sleep 15

echo "Checking container status..."
docker compose ps
ENDSSH

if [ $? -ne 0 ]; then
    echo -e "${RED}ERROR: Deployment failed${NC}"
    echo "Run rollback manually on server if needed."
    exit 1
fi

echo -e "${GREEN}✓ Deployment complete${NC}"
echo ""

echo -e "${YELLOW}Step 6: Verification${NC}"

# Test health endpoint
echo "Testing health endpoint..."
ssh "$PROD_SERVER" "curl -s http://localhost/health"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Health check passed${NC}"
else
    echo -e "${RED}⚠ Health check failed - manual verification needed${NC}"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}  Deployment Complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Test the application: https://aba.naurufinance.info"
echo "2. Login and verify existing data"
echo "3. Test creating a new batch"
echo "4. Check reviewer workflow"
echo ""
echo "Cleanup commands:"
echo "  rm /tmp/${ARCHIVE_NAME}           # on production"
echo "  rm ../${ARCHIVE_NAME}              # on local"
echo ""
echo "Rollback if needed:"
echo "  ssh $PROD_SERVER"
echo "  cd /home/fmis/Stacks/aba-stack && docker compose down"
echo "  cd .. && rm -rf aba-stack && mv aba-stack-old aba-stack"
echo "  cd aba-stack && docker compose up -d"
echo ""
