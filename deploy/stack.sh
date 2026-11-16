#!/usr/bin/env bash
# Run docker compose for one stack:  ./stack.sh prod|staging <compose args>
#   ./stack.sh staging up -d --build
#   ./stack.sh prod logs -f app
set -euo pipefail
cd "$(dirname "$0")"
stack="${1:?usage: stack.sh prod|staging <compose args>}"; shift
case "$stack" in prod|staging) ;; *) echo "unknown stack: $stack" >&2; exit 1 ;; esac
[ -f "$stack.env" ] || { echo "missing deploy/$stack.env" >&2; exit 1; }
[ -f "$stack.app.env" ] || { echo "missing deploy/$stack.app.env" >&2; exit 1; }
exec docker compose -p "vidoscript-$stack" --env-file "$stack.env" "$@"
