#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
. "$ROOT/scripts/lib-env.sh"
. "$ROOT/scripts/lib-e2e.sh"
PATH="$(pg_client_path)$PATH"
# Read from the current application database; create/drop scratch only on LOCAL_DATABASE_URL.
SOURCE_URL=$(database_url)
BASE_URL=$(local_database_url)
assert_local_database_url "$BASE_URL"
TMP_DB="yogurt_e2e_$(date +%Y%m%d%H%M%S)_$$"
TMP_URL=$(database_named_url "$BASE_URL" "$TMP_DB")
DUMP=$(mktemp /tmp/yogurt-e2e-XXXXXX.dump)
LOG=$(mktemp /tmp/yogurt-e2e-server-XXXXXX.log)
PID=''; CREATED=false
cleanup(){
  rc=$?
  trap - EXIT
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  if [ "$CREATED" = true ]; then dropdb --maintenance-db="$BASE_URL" --if-exists --force "$TMP_DB" >/dev/null 2>&1 || { [ "$rc" -ne 0 ] || rc=1; }; fi
  rm -f "$DUMP" "$LOG"
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
dump_application_database "$DUMP" "$SOURCE_URL"
createdb --maintenance-db="$BASE_URL" "$TMP_DB"
CREATED=true
restore_dump_sql "$DUMP" "$TMP_URL"
prepare_clone_e2e
PORT=3101
run_clone_e2e
