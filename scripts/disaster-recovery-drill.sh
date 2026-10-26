#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."; ROOT="$PWD"; export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
BACKUP=${1:-$(ls -1t .yogurt/backups/yogurt_ops-*.dump 2>/dev/null | head -1)}
[ -n "$BACKUP" ] || { echo 'No backup found' >&2; exit 2; }
CHECKSUM="$BACKUP.sha256"; [ -f "$CHECKSUM" ] || { echo "Missing checksum: $CHECKSUM" >&2; exit 2; }
EXPECTED=$(awk 'NR==1{print $1}' "$CHECKSUM"); ACTUAL=$(shasum -a 256 "$BACKUP"|awk '{print $1}'); [ "$EXPECTED" = "$ACTUAL" ] || { echo 'Checksum mismatch' >&2; exit 2; }
ROOT="${ROOT:-$PWD}"; . "$ROOT/scripts/lib-env.sh"; BASE_URL=$(database_url)
TMP_DB="yogurt_e2e_dr_$(date +%Y%m%d%H%M%S)_$$"   # the E2E tests only run against yogurt_e2e_* databases; TMP_URL=$(node -e "const u=new URL(process.argv[1]);u.pathname='/'+process.argv[2];process.stdout.write(u.toString())" "$BASE_URL" "$TMP_DB")
LOG=$(mktemp /tmp/yogurt-dr-server-XXXXXX.log); PID=''
cleanup(){ [ -z "$PID" ] || kill "$PID" 2>/dev/null || true; [ -z "$PID" ] || wait "$PID" 2>/dev/null || true; dropdb --maintenance-db="$BASE_URL" --if-exists --force "$TMP_DB" >/dev/null 2>&1 || true; rm -f "$LOG"; }
trap cleanup EXIT INT TERM
createdb --maintenance-db="$BASE_URL" "$TMP_DB"
pg_restore --no-owner --no-acl --exit-on-error -d "$TMP_URL" "$BACKUP"
PORT=3121   # one of the ports the E2E tests accept
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then echo "Port $PORT is already in use" >&2; exit 2; fi
DATABASE_URL="$TMP_URL" INTERNAL_APP_ORIGIN=http://127.0.0.1:$PORT PORT=$PORT node node_modules/next/dist/bin/next start -H 127.0.0.1 -p $PORT >"$LOG" 2>&1 & PID=$!
for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:$PORT/api/health >/dev/null 2>&1 && break; kill -0 "$PID" 2>/dev/null || { cat "$LOG" >&2; exit 1; }; sleep .5; done
HEALTH=$(curl -fsS http://127.0.0.1:$PORT/api/health); printf '%s' "$HEALTH" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(!j.db?.ok)process.exit(1)})'
DATABASE_URL="$TMP_URL" E2E_BASE_URL=http://127.0.0.1:$PORT node --env-file=.env tests/business-workflow-e2e.mjs
printf '{"ok":true,"backup":"%s","verifiedAt":"%s"}\n' "$(basename "$BACKUP")" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" | tee .yogurt/backups/last-dr-drill.json
