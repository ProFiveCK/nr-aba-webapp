#!/usr/bin/env bash
set -euo pipefail

cd /home/fmis/Stacks/aba-stack
/usr/bin/docker compose exec -T api npm run archive:batches
