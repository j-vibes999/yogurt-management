#!/bin/sh
# Daily at 03:15 (launchd com.yogurt.manager.backup) and before every update: dumps PostgreSQL,
# archives the payment-slip images next to it, and, when BACKUP_OFFSITE_DIR is set in .env,
# copies both there (encrypted when BACKUP_PASSPHRASE is set). The last line printed is the dump path.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
. "$ROOT/scripts/lib-env.sh"
PATH="$(pg_client_path)$PATH"
cd "$ROOT"
RUNTIME_DATA=$(runtime_data_directory)
DIR="$RUNTIME_DATA/backups"
STAMP="$(date '+%Y%m%d-%H%M%S')-$$"
BASE="$DIR/yogurt_ops-$STAMP"
TMP="$BASE.dump.tmp"
FINAL="$BASE.dump"
umask 077
mkdir -p "$DIR"
BACKUP_SOURCE_URL=$(env_value DATABASE_URL)
export BACKUP_SOURCE_URL
on_exit(){
  rc=$?
  trap - 0
  rm -f "$TMP"
  if [ "$rc" -ne 0 ]; then
    node "$ROOT/scripts/backup-state.mjs" backup-failure "$DIR" >/dev/null 2>&1 || true
    "$ROOT/scripts/send-alert.sh" error backup.failed "PostgreSQL backup failed (exit $rc)" >/dev/null 2>&1 || true
  fi
  exit "$rc"
}
trap on_exit 0
trap 'exit 130' INT
trap 'exit 143' TERM
node "$ROOT/scripts/backup-state.mjs" backup-start "$DIR"
DBURL=$(database_url)
[ -n "$DBURL" ] || { echo "DATABASE_URL is not set in .env" >&2; exit 2; }
dump_application_database "$TMP" "$DBURL"
pg_restore --list "$TMP" >/dev/null
mv "$TMP" "$FINAL"
(cd "$DIR" && shasum -a 256 "$(basename "$FINAL")" > "$(basename "$FINAL").sha256")

# Payment-slip images live outside the database, so they are archived next to the dump.
RECEIPTS=""
if [ -d "$RUNTIME_DATA/private-receipts" ] && [ -n "$(ls -A "$RUNTIME_DATA/private-receipts" 2>/dev/null)" ]; then
  RECEIPTS="$BASE.receipts.tar.gz"
  tar -czf "$RECEIPTS" -C "$RUNTIME_DATA" private-receipts
  (cd "$DIR" && shasum -a 256 "$(basename "$RECEIPTS")" > "$(basename "$RECEIPTS").sha256")
fi

OFFSITE=$(env_value BACKUP_OFFSITE_DIR)
BACKUP_RECEIPTS="$RECEIPTS" BACKUP_OFFSITE="$([ -n "$OFFSITE" ] && printf true || printf false)" node "$ROOT/scripts/backup-state.mjs" backup-artifact "$DIR" "$FINAL"
if [ -n "$OFFSITE" ]; then
  mkdir -p "$OFFSITE"
  PASS=$(env_value BACKUP_PASSPHRASE)
  for FILE in "$FINAL" "$FINAL.metadata.json" ${RECEIPTS:+"$RECEIPTS"}; do
    NAME=$(basename "$FILE")
    if [ -n "$PASS" ]; then
      BACKUP_PASSPHRASE="$PASS" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -in "$FILE" -out "$OFFSITE/$NAME.enc.tmp"
      mv "$OFFSITE/$NAME.enc.tmp" "$OFFSITE/$NAME.enc"
      (cd "$OFFSITE" && shasum -a 256 "$NAME.enc" > "$NAME.enc.sha256")
    else
      cp "$FILE" "$OFFSITE/$NAME.tmp"
      mv "$OFFSITE/$NAME.tmp" "$OFFSITE/$NAME"
      (cd "$OFFSITE" && shasum -a 256 "$NAME" > "$NAME.sha256")
    fi
  done
  find "$OFFSITE" -type f -name 'yogurt_ops-*' -mtime +30 -delete
fi

find "$DIR" -type f -name 'yogurt_ops-*' -mtime +14 -delete
BACKUP_RECEIPTS="$RECEIPTS" BACKUP_OFFSITE="$([ -n "$OFFSITE" ] && printf true || printf false)" node "$ROOT/scripts/backup-state.mjs" backup-success "$DIR" "$FINAL"
echo "$FINAL"
