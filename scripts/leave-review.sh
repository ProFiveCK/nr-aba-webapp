#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .leave-review
if [[ ! -f .leave-review/runtime.env ]]; then
  python3 - <<'ENV'
from pathlib import Path
import secrets, os
p=Path('.leave-review/runtime.env')
p.write_text('LEAVE_REVIEW_DB_PASSWORD='+secrets.token_hex(24)+'\nLEAVE_REVIEW_JWT_SECRET='+secrets.token_hex(32)+'\nLEAVE_REVIEW_ENC_KEY='+secrets.token_hex(32)+'\nLEAVE_REVIEW_PORT=8081\n')
os.chmod(p,0o600)
ENV
fi
compose=(docker compose --env-file .leave-review/runtime.env -f docker-compose.leave-review.yml)
case "${1:-up}" in
  up) "${compose[@]}" up -d --build --wait --wait-timeout 300 ;;
  status) "${compose[@]}" ps ;;
  stop) "${compose[@]}" stop ;;
  logs) "${compose[@]}" logs --tail 80 ;;
  *) echo 'Usage: scripts/leave-review.sh [up|status|stop|logs]' >&2; exit 1 ;;
esac
