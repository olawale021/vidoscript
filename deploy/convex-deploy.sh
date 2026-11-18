#!/usr/bin/env bash
# Push Convex functions (and optionally env vars) to one stack's self-hosted backend.
#   ./convex-deploy.sh staging
#   ./convex-deploy.sh prod
# Runs the Convex CLI in a throwaway Node container on the stack's network, using
# the admin key from <stack>.env. Also syncs Convex env vars:
#   from <stack>.env:      CLERK_JWT_ISSUER_DOMAIN, ADMIN_USER_IDS
#   from <stack>.app.env:  BROLL_WORKER_SECRET, INTERNAL_API_SECRET, ADMIN_EMAILS, R2_*, APIFY_TOKEN, HIGGSFIELD_API_KEY, YOUTUBE_API_KEY
#   STORAGE_PREFIX=<stack> (object-key prefix in the shared R2 bucket)
set -euo pipefail
cd "$(dirname "$0")"
stack="${1:?usage: convex-deploy.sh prod|staging}"
get() { { grep -E "^$1=" "$2" || true; } | tail -1 | cut -d= -f2-; }

AK=$(get CONVEX_SELF_HOSTED_ADMIN_KEY "$stack.env")
ISSUER=$(get CLERK_JWT_ISSUER_DOMAIN "$stack.env")
WS=$(get BROLL_WORKER_SECRET "$stack.app.env")
IS=$(get INTERNAL_API_SECRET "$stack.app.env")
AE=$(get ADMIN_EMAILS "$stack.app.env")
AU=$(get ADMIN_USER_IDS "$stack.env")
R2T=$(get R2_TOKEN "$stack.app.env"); R2A=$(get R2_ACCESS_KEY_ID "$stack.app.env"); R2S=$(get R2_SECRET_ACCESS_KEY "$stack.app.env")
R2E=$(get R2_ENDPOINT "$stack.app.env"); R2B=$(get R2_BUCKET "$stack.app.env")
AP=$(get APIFY_TOKEN "$stack.app.env")
HK=$(get HIGGSFIELD_API_KEY "$stack.app.env")
YK=$(get YOUTUBE_API_KEY "$stack.app.env")
GK=$(get GEMINI_API_KEY "$stack.app.env")
[ -n "$AK" ] || { echo "no CONVEX_SELF_HOSTED_ADMIN_KEY in $stack.env" >&2; exit 1; }

docker run --rm --network "vidoscript-${stack}_default" -v "$(cd .. && pwd)":/src:ro \
  -e CONVEX_SELF_HOSTED_URL=http://backend:3210 -e CONVEX_SELF_HOSTED_ADMIN_KEY="$AK" \
  -e ISSUER="$ISSUER" -e WS="$WS" -e IS="$IS" -e AE="$AE" -e AU="$AU" \
  -e R2T="$R2T" -e R2A="$R2A" -e R2S="$R2S" -e R2E="$R2E" -e R2B="$R2B" -e AP="$AP" -e HK="$HK" -e YK="$YK" -e GK="$GK" -e SP="$stack" node:24-bookworm-slim sh -c '
    set -e
    mkdir /app && cd /app
    tar -C /src --exclude=node_modules --exclude=.next -cf - . | tar -xf -
    npm ci --no-audit --no-fund --loglevel=error >/dev/null 2>&1
    [ -n "$ISSUER" ] && npx convex env set CLERK_JWT_ISSUER_DOMAIN "$ISSUER" >/dev/null && echo "env: CLERK_JWT_ISSUER_DOMAIN set"
    setenv() { [ -n "$2" ] && npx convex env set "$1" "$2" >/dev/null && echo "env: $1 set"; true; }
    setenv BROLL_WORKER_SECRET "$WS"
    setenv INTERNAL_API_SECRET "$IS"
    setenv ADMIN_EMAILS "$AE"
    setenv ADMIN_USER_IDS "$AU"
    setenv R2_TOKEN "$R2T"
    setenv R2_ACCESS_KEY_ID "$R2A"
    setenv R2_SECRET_ACCESS_KEY "$R2S"
    setenv R2_ENDPOINT "$R2E"
    setenv R2_BUCKET "$R2B"
    setenv STORAGE_PREFIX "$SP"
    setenv APIFY_TOKEN "$AP"
    setenv HIGGSFIELD_API_KEY "$HK"
    setenv YOUTUBE_API_KEY "$YK"
    setenv GEMINI_API_KEY "$GK"
    npx convex deploy -y 2>&1 | tail -3
  '
