#!/bin/bash
set -e

# RON ABA Stack - Pull & Rebuild Script
# Pulls latest changes from the current branch, rebuilds the frontend,
# and rebuilds/restarts the Docker Compose stack.

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Resolve repo root (directory this script lives in)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE="${ENV_FILE:-.env.prod}"
CLIENT_DIR="app/client"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  RON ABA Stack - Pull & Rebuild${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# --- Step 1: Git pull ---
echo -e "${YELLOW}Step 1: Pulling latest changes${NC}"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "  Branch: $BRANCH"

git pull --ff-only
echo -e "${GREEN}✓ Git pull complete${NC}"
echo ""

# --- Step 2: Build frontend ---
echo -e "${YELLOW}Step 2: Building frontend${NC}"

if [ ! -d "$CLIENT_DIR" ]; then
    echo -e "${RED}ERROR: $CLIENT_DIR not found${NC}"
    exit 1
fi

cd "$CLIENT_DIR"

if [ ! -d "node_modules" ]; then
    echo "  node_modules missing — running npm install..."
    npm install
fi

echo "  Building production bundle..."
npm run build

if [ ! -f "build/index.html" ]; then
    echo -e "${RED}ERROR: Build failed — build/index.html not created${NC}"
    exit 1
fi

cd "$SCRIPT_DIR"

# nginx serves app/client/dist directly from this working tree, so the build
# above deliberately writes somewhere else and is moved across here: new
# assets first, index.html last, stale files only once nobody needs them.
echo "  Publishing build → ${CLIENT_DIR}/dist/"
./scripts/publish-frontend.sh
echo -e "${GREEN}✓ Frontend published${NC}"
echo ""

# --- Step 3: Rebuild & restart Docker stack ---
echo -e "${YELLOW}Step 3: Rebuilding Docker stack${NC}"

if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}ERROR: $ENV_FILE not found${NC}"
    exit 1
fi

echo "  Building images and bringing up the full stack..."
docker compose --env-file "$ENV_FILE" up -d --build

# `up --build` rebuilds the api image but does not reliably recreate the
# running api container, and recreating api changes its IP (stale in nginx).
# Force-recreate the app containers so the new backend code is actually live.
echo "  Force-recreating app containers (api, web)..."
docker compose --env-file "$ENV_FILE" up -d --force-recreate --no-deps api web

echo ""
echo "  Waiting for services to start..."
sleep 10

docker compose --env-file "$ENV_FILE" ps
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Pull & Rebuild Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Check logs:   docker compose --env-file $ENV_FILE logs -f"
echo "Health check: curl -s http://localhost/health"
echo ""
