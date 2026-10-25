#!/bin/sh
set -eu
ROOT="/Users/justkay/Projects/Yogurt_Super_Web"
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
cd "$ROOT"
on_exit(){ rc=$?; [ "$rc" -eq 0 ] || "$ROOT/scripts/send-alert.sh" error backup.failed "PostgreSQL backup failed (exit $rc)" >/dev/null 2>&1 || true; }
trap on_exit 0
DBURL=$(node -e "require('dotenv').config({path:'.env'}); const u=new URL(process.env.DATABASE_URL); u.search=''; process.stdout.write(u.toString())")
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
find "$DIR" -type f \( -name 'yogurt_ops-*.dump' -o -name 'yogurt_ops-*.dump.sha256' \) -mtime +14 -delete
printf '{"ok":true,"file":"%s","bytes":%s,"createdAt":"%s"}\n' "$(basename "$FINAL")" "$(stat -f%z "$FINAL")" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$DIR/latest.json"
echo "$FINAL"
