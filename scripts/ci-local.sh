#!/usr/bin/env bash
# Local CI: the whole check suite, from a clean state. Backend tests run
# alongside the client checks; any failure fails the run. Run it
# (npm run ci:local) before every push; there is no GitHub CI.
# Needs Docker for the backend's throwaway test database.
set -euo pipefail

# `npm run` exports the user's npmrc as npm_config_* env vars; newer npm
# refuses an env-level allow-scripts in project installs (EALLOWSCRIPTS).
unset npm_config_allow_scripts

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
step() { printf '\n==> %s\n' "$*"; }

docker info >/dev/null 2>&1 || { echo "Docker is not running (needed for the backend test database)." >&2; exit 1; }

step "Clean client build output"
rm -rf "$ROOT/app/client/build"

step "Install dependencies (backend and client in parallel)"
(cd "$ROOT/app/backend" && npm ci --no-fund --no-audit) & backend_ci=$!
(cd "$ROOT/app/client" && npm ci --no-fund --no-audit) & client_ci=$!
failed=0
wait "$backend_ci" || failed=1
wait "$client_ci" || failed=1
[ "$failed" = 0 ] || { echo "npm ci failed" >&2; exit 1; }

# The backend suite (Docker + Postgres) and the client checks are independent,
# so run them side by side. Backend output is held back and printed after.
step "Backend tests (with Postgres) in parallel with client lint, build, tests"
backend_log="$(mktemp)"
trap 'rm -f "$backend_log"' EXIT
(cd "$ROOT/app/backend" && npm run test:db) >"$backend_log" 2>&1 & backend_tests=$!

client_failed=0
(cd "$ROOT/app/client" && npm run lint && npm run build && npm test) || client_failed=1

backend_failed=0
wait "$backend_tests" || backend_failed=1
step "Backend test output"
cat "$backend_log"
[ "$client_failed" = 0 ] || { echo "Client lint/build/tests failed" >&2; exit 1; }
[ "$backend_failed" = 0 ] || { echo "Backend tests failed" >&2; exit 1; }

step "Audit runtime deps (high and above): backend, client"
(cd "$ROOT/app/backend" && npm audit --omit=dev --audit-level=high)
(cd "$ROOT/app/client" && npm audit --omit=dev --audit-level=high)

printf '\nci:local passed\n'
