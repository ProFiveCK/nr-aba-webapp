#!/usr/bin/env bash
# Runs the whole backend suite, including the tests that need a real Postgres.
# Starts a throwaway container, waits for it, runs the tests, always cleans up.
set -euo pipefail

# Unique per run, on a free port, so parallel runs (other worktrees or
# sessions) cannot remove each other's database. TEST_DB_PORT pins a port.
CONTAINER=ron-hr-test-db-$$

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --rm --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_USER=test -e POSTGRES_DB=test \
  -p "127.0.0.1:${TEST_DB_PORT:-}:5432" postgres:15 >/dev/null
PORT=$(docker port "$CONTAINER" 5432/tcp | head -1 | sed 's/.*://')
echo "Started Postgres on port $PORT"

# The initialization server accepts Unix sockets before stopping again.
# Wait for TCP so tests start only against the final Postgres server.
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U test >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -h 127.0.0.1 -U test >/dev/null

export TEST_DATABASE_URL="postgres://test:test@127.0.0.1:$PORT/test"
export JWT_SECRET=0123456789abcdef0123456789abcdef
# Serially: the integration files share one database and truncate the same
# tables, so running them in parallel makes each one wipe the other's rows.
node --test --test-concurrency=1 "src/**/*.test.js"
