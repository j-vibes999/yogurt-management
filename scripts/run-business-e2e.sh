#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
[ -f .env ] || { echo '.env missing' >&2; exit 2; }
if lsof -nP -iTCP:3101 -sTCP:LISTEN >/dev/null 2>&1; then
  echo 'Test port 3101 is already in use; refusing to run against another server' >&2
  exit 2
fi
ROOT="${ROOT:-$PWD}"; . "$ROOT/scripts/lib-env.sh"; BASE_URL=$(database_url)
TMP_DB="yogurt_e2e_$(date +%Y%m%d%H%M%S)_$$"
TMP_URL=$(node -e "const u=new URL(process.argv[1]);u.pathname='/${TMP_DB}';process.stdout.write(u.toString())" "$BASE_URL")
DUMP=$(mktemp /tmp/yogurt-e2e-XXXXXX.dump)
LOG=$(mktemp /tmp/yogurt-e2e-server-XXXXXX.log)
PID=''
cleanup(){
  [ -z "$PID" ] || kill "$PID" 2>/dev/null || true
  [ -z "$PID" ] || wait "$PID" 2>/dev/null || true
  dropdb --maintenance-db="$BASE_URL" --if-exists --force "$TMP_DB" >/dev/null 2>&1 || true
  rm -f "$DUMP" "$LOG"
}
trap cleanup EXIT INT TERM
pg_dump -Fc --no-owner --no-acl -f "$DUMP" "$BASE_URL"
createdb --maintenance-db="$BASE_URL" "$TMP_DB"
pg_restore --no-owner --no-acl --exit-on-error -d "$TMP_URL" "$DUMP"
DATABASE_URL="$TMP_URL" INTERNAL_APP_ORIGIN=http://127.0.0.1:3101 PORT=3101 node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3101 >"$LOG" 2>&1 & PID=$!
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3101/api/health >/dev/null 2>&1; then break; fi
  if ! kill -0 "$PID" 2>/dev/null; then cat "$LOG" >&2; exit 1; fi
  sleep 0.5
done
curl -fsS http://127.0.0.1:3101/api/health >/dev/null || { cat "$LOG" >&2; exit 1; }
DATABASE_URL="$TMP_URL" E2E_BASE_URL=http://127.0.0.1:3101 node --env-file=.env tests/business-workflow-e2e.mjs
