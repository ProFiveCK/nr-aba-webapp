#!/usr/bin/env sh
# Keep Linux dependencies in the review volume; install only when manifests change.
set -eu
cd /client
manifest_hash=$(cat package.json package-lock.json 2>/dev/null | sha256sum | cut -d ' ' -f 1)
previous_hash=$(cat node_modules/.leave-review-manifest 2>/dev/null || true)
if [ "$manifest_hash" != "$previous_hash" ] || [ ! -x node_modules/.bin/vite ]; then
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund
  else
    npm install --no-audit --no-fund
    manifest_hash=$(cat package.json package-lock.json | sha256sum | cut -d ' ' -f 1)
  fi
  printf '%s\n' "$manifest_hash" > node_modules/.leave-review-manifest
fi
exec npm run dev -- --host 0.0.0.0
