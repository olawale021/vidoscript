#!/usr/bin/env bash
# Run a Convex function against one stack's self-hosted backend (admin access).
#   ./convex-run.sh prod migrations:pending '{"limit":5}'
#   ./convex-run.sh prod migrationsNode:copyToR2
# Uses the worker image (Convex CLI + this repo's convex/ folder already inside).
set -euo pipefail
cd "$(dirname "$0")"
stack="${1:?usage: convex-run.sh prod|staging <function> [json args]}"; fn="${2:?function name}"; args="${3:-{\}}"
AK=$({ grep -E "^CONVEX_SELF_HOSTED_ADMIN_KEY=" "$stack.env" || true; } | tail -1 | cut -d= -f2-)
[ -n "$AK" ] || { echo "no admin key in $stack.env" >&2; exit 1; }
docker run --rm --network "vidoscript-${stack}_default" \
  -e CONVEX_SELF_HOSTED_URL=http://backend:3210 -e CONVEX_SELF_HOSTED_ADMIN_KEY="$AK" \
  -e HOME=/tmp -w /app "vidoscript-worker:$stack" npx convex run "$fn" "$args"
