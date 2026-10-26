#!/bin/sh
# Daily at 03:15 (launchd com.yogurt.manager.backup) and before every update: dumps PostgreSQL,
# archives the payment-slip images next to it, and, when BACKUP_OFFSITE_DIR is set in .env,
# copies both there (encrypted when BACKUP_PASSPHRASE is set). The last line printed is the dump path.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
. "$ROOT/scripts/lib-env.sh"
cd "$ROOT"
on_exit(){ rc=$?; [ "$rc" -eq 0 ] || "$ROOT/scripts/send-alert.sh" error backup.failed "PostgreSQL backup failed (exit $rc)" >/dev/null 2>&1 || true; }
trap on_exit 0
DBURL=$(database_url)
[ -n "$DBURL" ] || { echo "DATABASE_URL is not set in .env" >&2; exit 2; }
DIR="$ROOT/.yogurt/backups"
STAMP=$(date '+%Y%m%d-%H%M%S')
BASE="$DIR/yogurt_ops-$STAMP"
TMP="$BASE.dump.tmp"
FINAL="$BASE.dump"
mkdir -p "$DIR"
umask 077
pg_dump --format=custom --compress=6 --no-owner --no-acl --file="$TMP" "$DBURL"
pg_restore --list "$TMP" >/dev/null
mv "$TMP" "$FINAL"
shasum -a 256 "$FINAL" > "$FINAL.sha256"

# Payment-slip images live outside the database, so they are archived next to the dump.
RECEIPTS=""
if [ -d "$ROOT/.yogurt/private-receipts" ] && [ -n "$(ls -A "$ROOT/.yogurt/private-receipts" 2>/dev/null)" ]; then
  RECEIPTS="$BASE.receipts.tar.gz"
  tar -czf "$RECEIPTS" -C "$ROOT/.yogurt" private-receipts
  shasum -a 256 "$RECEIPTS" > "$RECEIPTS.sha256"
fi

OFFSITE=$(env_value BACKUP_OFFSITE_DIR)
if [ -n "$OFFSITE" ]; then
  mkdir -p "$OFFSITE"
  PASS=$(env_value BACKUP_PASSPHRASE)
  for FILE in "$FINAL" ${RECEIPTS:+"$RECEIPTS"}; do
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
printf '{"ok":true,"file":"%s","bytes":%s,"receipts":%s,"offsite":%s,"createdAt":"%s"}\n' \
  "$(basename "$FINAL")" "$(stat -f%z "$FINAL")" \
  "$(if [ -n "$RECEIPTS" ]; then printf '"%s"' "$(basename "$RECEIPTS")"; else printf null; fi)" \
  "$([ -n "$OFFSITE" ] && printf true || printf false)" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$DIR/latest.json"
echo "$FINAL"
