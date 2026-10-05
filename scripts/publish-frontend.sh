#!/usr/bin/env bash
# Publishes a built frontend into the directory nginx serves.
#
# nginx bind-mounts app/client/dist straight from the working tree, so
# whatever is in that directory IS the live site. Vite therefore builds to
# app/client/build (see vite.config.ts) and this script moves the result
# across, rather than letting a plain `npm run build` empty the live
# directory mid-request — which took the site down once.
#
# The order matters:
#
#   1. New assets land first. Filenames are content-hashed, so they cannot
#      collide with what is already being served.
#   2. index.html is replaced last, by rename, so it is never half-written.
#      Until that instant the old page is intact; after it, every asset the
#      new page names is already present.
#   3. Only then are old files removed, and only those older than the
#      previous publish. A browser that loaded the page before the swap still
#      lazy-loads chunks from the build it started with, so deleting those
#      immediately breaks whoever is mid-session.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${1:-$ROOT/app/client/build}"
LIVE="${2:-$ROOT/app/client/dist}"
MANIFEST="$LIVE/.previous-publish"

if [ ! -f "$BUILD/index.html" ]; then
  echo "ERROR: no build at $BUILD (run: cd app/client && npm run build)" >&2
  exit 1
fi

mkdir -p "$LIVE/assets"

# 1. Additive: new assets alongside the old.
if [ -d "$BUILD/assets" ]; then
  cp -a "$BUILD/assets/." "$LIVE/assets/"
fi
# Any other top-level files (favicon, logo, robots...), excluding the page.
find "$BUILD" -maxdepth 1 -type f ! -name index.html -exec cp -a {} "$LIVE/" \;

# What this build owns, for the next publish to compare against.
NEW_FILES="$(cd "$BUILD" && find . -type f | sed 's#^\./##' | sort)"

# 2. The page itself, atomically.
cp "$BUILD/index.html" "$LIVE/.index.html.new"
mv -f "$LIVE/.index.html.new" "$LIVE/index.html"

# 3. Remove files belonging to neither this build nor the one before it, so
#    sessions that were open across the last deploy keep working.
PREVIOUS=""
[ -f "$MANIFEST" ] && PREVIOUS="$(cat "$MANIFEST")"
KEEP="$(printf '%s\n%s\n' "$NEW_FILES" "$PREVIOUS" | sort -u)"

removed=0
while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ "$file" = ".previous-publish" ] && continue
  if ! printf '%s\n' "$KEEP" | grep -qxF "$file"; then
    rm -f "$LIVE/$file"
    removed=$((removed + 1))
  fi
done < <(cd "$LIVE" && find . -type f | sed 's#^\./##')

printf '%s\n' "$NEW_FILES" > "$MANIFEST"

echo "Published $(printf '%s\n' "$NEW_FILES" | wc -l | tr -d ' ') files to $LIVE (removed $removed stale)"
