#!/usr/bin/env bash
# Runs the whole backend suite, including the tests that need a real Postgres.
# Starts a throwaway container, waits for it, runs the tests, always cleans up.
set -euo pipefail

CONTAINER=ron-hr-test-db
PORT=${TEST_DB_PORT:-55433}

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "Starting Postgres on port $PORT ..."
docker run -d --rm --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=test -e POSTGRES_USER=test -e POSTGRES_DB=test \
  -p "$PORT:5432" postgres:15 >/dev/null

for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U test >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U test >/dev/null

export TEST_DATABASE_URL="postgres://test:test@127.0.0.1:$PORT/test"
export JWT_SECRET=0123456789abcdef0123456789abcdef
# Serially: the integration files share one database and truncate the same
# tables, so running them in parallel makes each one wipe the other's rows.
node --test --test-concurrency=1 "src/**/*.test.js"
