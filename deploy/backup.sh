#!/usr/bin/env bash
# Nightly backup of one stack (default: prod). Run by cron (see deploy/README or
# /etc/cron.d/vidoscript-backup):
#   ./backup.sh [prod]
#
# Makes, in ~/backups/<stack>/<UTC timestamp>/:
#   convex-export.zip  Convex snapshot incl. file storage (restore: npx convex import)
#   postgres.sql.gz    raw Postgres dump (fast full restore of the same Convex version)
# Keeps the newest $KEEP backups. If deploy/backup.env has R2_* settings, also
# uploads each backup to Cloudflare R2 (off-server copy).
set -euo pipefail
cd "$(dirname "$0")"
stack="${1:-prod}"
KEEP="${KEEP:-7}"
get() { { grep -E "^$1=" "$2" || true; } | tail -1 | cut -d= -f2-; }

AK=$(get CONVEX_SELF_HOSTED_ADMIN_KEY "$stack.env")
[ -n "$AK" ] || { echo "no admin key in $stack.env" >&2; exit 1; }

root="$HOME/backups/$stack"
stamp=$(date -u +%Y-%m-%dT%H%MZ)
dir="$root/$stamp"
mkdir -p "$dir"
echo "[backup] $stack -> $dir"

# 1. Postgres dump
docker exec "vidoscript-$stack-postgres-1" pg_dump -U convex -d convex_self_hosted --no-owner \
  | gzip -6 > "$dir/postgres.sql.gz"
echo "[backup] postgres.sql.gz $(du -h "$dir/postgres.sql.gz" | cut -f1)"

# 2. Convex export (portable; includes uploaded files). Reuses the worker image,
#    which already has the Convex CLI installed.
docker run --rm --network "vidoscript-${stack}_default" \
  -u "$(id -u):$(id -g)" -v "$dir":/out \
  -e CONVEX_SELF_HOSTED_URL=http://backend:3210 -e CONVEX_SELF_HOSTED_ADMIN_KEY="$AK" \
  -e HOME=/tmp -w /app "vidoscript-worker:$stack" \
  npx convex export --include-file-storage --path /out/convex-export.zip >/dev/null
echo "[backup] convex-export.zip $(du -h "$dir/convex-export.zip" | cut -f1)"

# 3. Optional off-server copy to R2
if [ -f backup.env ] && [ -n "$(get R2_BUCKET backup.env)" ]; then
  docker run --rm -v "$root":/data:ro \
    -e RCLONE_CONFIG_R2_TYPE=s3 -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare \
    -e RCLONE_CONFIG_R2_ACCESS_KEY_ID="$(get R2_ACCESS_KEY_ID backup.env)" \
    -e RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(get R2_SECRET_ACCESS_KEY backup.env)" \
    -e RCLONE_CONFIG_R2_ENDPOINT="$(get R2_ENDPOINT backup.env)" \
    rclone/rclone:1.68 copy "/data/$stamp" "r2:$(get R2_BUCKET backup.env)/backups/$stack/$stamp" --s3-no-check-bucket
  echo "[backup] uploaded to R2"
fi

# 4. Retention
ls -1d "$root"/*/ 2>/dev/null | sort | head -n -"$KEEP" | xargs -r rm -rf
echo "[backup] done; kept $(ls -1d "$root"/*/ | wc -l) backup(s)"
