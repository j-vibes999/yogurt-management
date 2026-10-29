#!/bin/sh
# Restores original backup rows, checks invariants/receipt integrity, then removes the local scratch DB.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export PATH
. "$ROOT/scripts/lib-env.sh"
PATH="$(pg_client_path)$PATH"
cd "$ROOT"
RUNTIME_DATA=$(runtime_data_directory)
BACKUP=${1:-$(ls -1t "$RUNTIME_DATA"/backups/yogurt_ops-*.dump 2>/dev/null | head -1)}
[ -n "$BACKUP" ] || { echo 'No backup found' >&2; exit 2; }
DIR=$(dirname "$BACKUP")
ADMINURL=''; NAME=''; CREATED=false
cleanup(){
  rc=$?
  trap - 0
  if [ "$CREATED" = true ]; then
    psql "$ADMINURL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$NAME\" WITH (FORCE);" >/dev/null 2>&1 || { [ "$rc" -ne 0 ] || rc=1; }
  fi
  if [ "$rc" -ne 0 ]; then
    node "$ROOT/scripts/backup-state.mjs" restore-failure "$DIR" "$BACKUP" >/dev/null 2>&1 || true
    "$ROOT/scripts/send-alert.sh" error backup.restore_verification_failed "Restore verification failed (exit $rc)" >/dev/null 2>&1 || true
  fi
  exit "$rc"
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM
node "$ROOT/scripts/backup-state.mjs" restore-start "$DIR" "$BACKUP"
verify_backup_checksum "$BACKUP"
DBURL=$(local_database_url)
assert_local_database_url "$DBURL"
ADMINURL=$(database_named_url "$DBURL" postgres)
NAME="yogurt_restore_verify_$(date '+%Y%m%d%H%M%S')_$$"
RESTOREURL=$(database_named_url "$DBURL" "$NAME")
psql "$ADMINURL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$NAME\";" >/dev/null
CREATED=true
restore_dump_sql "$BACKUP" "$RESTOREURL"
verify_restored_invariants "$RESTOREURL" "$BACKUP"
cat "$DIR/last-restore-verification.json"
