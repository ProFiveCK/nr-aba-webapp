#!/usr/bin/env bash
# Local CI: the whole check suite, from a clean state, stopping at the first
# failure. Run it (npm run ci:local) before every push; there is no GitHub CI.
# Needs Docker for the backend's throwaway test database.
set -euo pipefail

# `npm run` exports the user's npmrc as npm_config_* env vars; newer npm
# refuses an env-level allow-scripts in project installs (EALLOWSCRIPTS).
unset npm_config_allow_scripts

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
step() { printf '\n==> %s\n' "$*"; }

step "Clean client build output"
rm -rf "$ROOT/app/client/build"

step "Backend: npm ci"
(cd "$ROOT/app/backend" && npm ci --no-fund --no-audit)
step "Client: npm ci"
(cd "$ROOT/app/client" && npm ci --no-fund --no-audit)

step "Backend: tests (with Postgres)"
(cd "$ROOT/app/backend" && npm run test:db)

step "Client: lint"
(cd "$ROOT/app/client" && npm run lint)
step "Client: build"
(cd "$ROOT/app/client" && npm run build)
step "Client: tests"
(cd "$ROOT/app/client" && npm test)

step "Backend: audit runtime deps (high and above)"
(cd "$ROOT/app/backend" && npm audit --omit=dev --audit-level=high)

printf '\nci:local passed\n'
