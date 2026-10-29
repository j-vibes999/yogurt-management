#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
. "$ROOT/scripts/lib-env.sh"
. "$ROOT/scripts/lib-e2e.sh"
PATH="$(pg_client_path)$PATH"
RUNTIME_DATA=$(runtime_data_directory)
BACKUP=${1:-$(ls -1t "$RUNTIME_DATA"/backups/yogurt_ops-*.dump 2>/dev/null | head -1)}
[ -n "$BACKUP" ] || { echo 'No backup found' >&2; exit 2; }
DIR=$(dirname "$BACKUP")
BASE_URL=$(local_database_url)
assert_local_database_url "$BASE_URL"
TMP_DB="yogurt_e2e_dr_$(date +%Y%m%d%H%M%S)_$$"
TMP_URL=$(database_named_url "$BASE_URL" "$TMP_DB")
LOG=$(mktemp /tmp/yogurt-dr-server-XXXXXX)
PID=''; CREATED=false; RESTORE_VERIFIED=false; E2E_RUNTIME_DATA=''
cleanup(){
  rc=$?
  trap - EXIT
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; fi
  if [ -n "$E2E_RUNTIME_DATA" ]; then rm -rf "$E2E_RUNTIME_DATA" || { [ "$rc" -ne 0 ] || rc=1; }; fi
  if [ "$CREATED" = true ]; then dropdb --maintenance-db="$BASE_URL" --if-exists --force "$TMP_DB" >/dev/null 2>&1 || { [ "$rc" -ne 0 ] || rc=1; }; fi
  rm -f "$LOG"
  if [ "$rc" -ne 0 ]; then
    if [ "$RESTORE_VERIFIED" = false ]; then node "$ROOT/scripts/backup-state.mjs" restore-failure "$DIR" "$BACKUP" >/dev/null 2>&1 || true; fi
    node "$ROOT/scripts/backup-state.mjs" dr-failure "$DIR" "$BACKUP" >/dev/null 2>&1 || true
    "$ROOT/scripts/send-alert.sh" error backup.dr_failed "Disaster recovery drill failed (exit $rc)" >/dev/null 2>&1 || true
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node "$ROOT/scripts/backup-state.mjs" dr-start "$DIR" "$BACKUP"
node "$ROOT/scripts/backup-state.mjs" restore-start "$DIR" "$BACKUP"
verify_backup_checksum "$BACKUP"
createdb --maintenance-db="$BASE_URL" "$TMP_DB"
CREATED=true
restore_dump_sql "$BACKUP" "$TMP_URL"
# These checks and metadata describe the unmodified restored rows.
verify_restored_invariants "$TMP_URL" "$BACKUP"
RESTORE_VERIFIED=true
if [ "${DR_RUN_E2E:-1}" = 1 ]; then
  prepare_clone_e2e
  PORT=3121
  run_clone_e2e
  E2E_FIXTURE_MODE="$E2E_FIXTURE_MODE" node "$ROOT/scripts/backup-state.mjs" dr-success "$DIR" "$BACKUP"
  cat "$DIR/last-dr-drill.json"
else
  node "$ROOT/scripts/backup-state.mjs" dr-skipped "$DIR" "$BACKUP"
  echo 'Restore and original-data invariants passed; application E2E was not requested.'
fi
