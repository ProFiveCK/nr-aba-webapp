# Quick Start (macOS)

This stack runs locally on macOS via Docker Desktop. The easiest path is to use the interactive setup script, which creates `.env.prod`, builds the front-end, and starts the Docker Compose services.

## Prerequisites

- Docker Desktop
- Git
- Node.js 20+ (required to build the front-end)

## One-command setup

```bash
git clone https://github.com/YOUR-ORG/aba-stack.git
cd aba-stack

./setup-dev.sh
```

What `./setup-dev.sh` does (today):

- Verifies Docker + Docker Compose + Node.js
- Creates/updates `.env.prod` from `.env.prod.example`
- Generates a database password + `JWT_SECRET`
- Sets macOS default `WEB_PORT=8080` (so you don’t need sudo)
- Creates external Docker network `ron-net` and external volume `ron-stack_pgdata`
- Builds the front-end to `app/client/dist/`
- Starts the Compose stack

## Access

- Web UI: <http://localhost:8080>
- API (via proxy): <http://localhost:8080/api/>
- Health check: <http://localhost:8080/health>

## Default admin

The setup script currently bootstraps a default admin account:

- Email: `admin@example.com`
- Password: `Admin123!`

Change this password immediately after first login.

## Common commands

```bash
docker compose ps
docker compose logs -f
docker compose restart
docker compose down
```

## Port conflicts

If port `8080` is already in use, edit `.env.prod` and change `WEB_PORT`, then restart:

```bash
nano .env.prod
# WEB_PORT=8081

docker compose down
docker compose up -d
```

## Manual setup (no script)

```bash
cp .env.prod.example .env.prod
nano .env.prod

docker network create ron-net
docker volume create ron-stack_pgdata

cd app/client
npm install
npm run build
cd ../..

docker compose up -d --build
```

If you get stuck, start with logs:

```bash
docker compose logs -f --tail=200
```
