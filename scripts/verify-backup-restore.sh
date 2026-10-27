#!/bin/sh
set -eu
# Weekly (launchd com.yogurt.manager.backup-verify): restores the newest backup into a scratch database,
# checks counts and invariants, checks the payment-slip archive next to it, then drops the scratch database.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
. "$ROOT/scripts/lib-env.sh"
PATH="$(pg_client_path)$PATH"
cd "$ROOT"
fail(){ code="$1"; shift; msg="$*"; echo "$msg" >&2; "$ROOT/scripts/send-alert.sh" error backup.restore_verification_failed "$msg" >/dev/null 2>&1 || true; exit "$code"; }
BACKUP=${1:-$(ls -1t "$ROOT"/.yogurt/backups/yogurt_ops-*.dump 2>/dev/null | head -1)}
[ -n "$BACKUP" ] || fail 2 "No backup found"
CHECKSUM="$BACKUP.sha256"
[ -f "$CHECKSUM" ] || fail 2 "Missing checksum: $CHECKSUM"
EXPECTED_HASH=$(awk 'NR==1 {print $1}' "$CHECKSUM")
ACTUAL_HASH=$(shasum -a 256 "$BACKUP" | awk '{print $1}')
[ -n "$EXPECTED_HASH" ] && [ "$EXPECTED_HASH" = "$ACTUAL_HASH" ] || fail 2 "Backup checksum mismatch: $BACKUP"
# The scratch database is made on this Mac's PostgreSQL, also after the move to Supabase.
DBURL=$(local_database_url)
[ -n "$DBURL" ] || fail 2 "DATABASE_URL is not set in .env"
ADMINURL=$(node -e "const u=new URL(process.argv[1]); u.pathname='/postgres'; process.stdout.write(u.toString())" "$DBURL")
NAME="yogurt_restore_verify_$(date '+%Y%m%d%H%M%S')_$$"
RESTOREURL=$(node -e "const u=new URL(process.argv[1]); u.pathname='/'+process.argv[2]; process.stdout.write(u.toString())" "$DBURL" "$NAME")
cleanup(){ rc=$?; psql "$ADMINURL" -v ON_ERROR_STOP=0 -c "DROP DATABASE IF EXISTS \"$NAME\" WITH (FORCE);" >/dev/null 2>&1 || true; [ "$rc" -eq 0 ] || "$ROOT/scripts/send-alert.sh" error backup.restore_verification_failed "Restore verification failed (exit $rc)" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
psql "$ADMINURL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$NAME\";" >/dev/null
restore_dump_sql "$BACKUP" "$RESTOREURL"
RESULT=$(psql "$RESTOREURL" -Atc "SELECT json_build_object('users',(SELECT count(*) FROM users),'stores',(SELECT count(*) FROM stores),'materials',(SELECT count(*) FROM raw_materials),'settlements',(SELECT count(*) FROM settlements),'auditLogs',(SELECT count(*) FROM audit_logs));")
RAW_NEG=$(psql "$RESTOREURL" -Atc "SELECT count(*) FROM raw_materials WHERE current_stock < 0;")
FRIDGE_NEG=$(psql "$RESTOREURL" -Atc "SELECT count(*) FROM fridge_inventory WHERE current_stock < 0;")
BATCH_INVALID=$(psql "$RESTOREURL" -Atc "SELECT count(*) FROM production_batches WHERE quantity_produced <= 0 OR quantity_remaining < 0 OR quantity_remaining > quantity_produced OR total_material_cost < 0 OR unit_cost < 0 OR exp_date < mfg_date;")
SETTLEMENT_INVALID=$(psql "$RESTOREURL" -Atc "SELECT count(*) FROM settlements WHERE gross_amount < 0 OR store_commission_amount < 0 OR net_payable_amount < 0 OR previous_balance < 0 OR paid_amount < 0 OR closing_balance < 0 OR store_commission_amount > gross_amount OR net_payable_amount > gross_amount;")
[ "$RAW_NEG" = "0" ] || fail 3 "restored DB has negative raw stock"
[ "$FRIDGE_NEG" = "0" ] || fail 3 "restored DB has negative fridge stock"
[ "$BATCH_INVALID" = "0" ] || fail 3 "restored DB has invalid production batch quantities/costs"
[ "$SETTLEMENT_INVALID" = "0" ] || fail 3 "restored DB has invalid settlement amounts"
# The payment-slip archive made with this dump (if there were slips) must match its checksum.
RECEIPTS="${BACKUP%.dump}.receipts.tar.gz"
RECEIPT_FILES=0
if [ -f "$RECEIPTS" ]; then
  [ -f "$RECEIPTS.sha256" ] || fail 2 "Missing checksum: $RECEIPTS.sha256"
  [ "$(awk 'NR==1 {print $1}' "$RECEIPTS.sha256")" = "$(shasum -a 256 "$RECEIPTS" | awk '{print $1}')" ] || fail 2 "Receipt archive checksum mismatch: $RECEIPTS"
  RECEIPT_FILES=$(tar -tzf "$RECEIPTS" | grep -c '^private-receipts/.' || true)
fi
printf '{"ok":true,"backup":"%s","verifiedAt":"%s","counts":%s,"receiptFiles":%s}\n' "$(basename "$BACKUP")" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RESULT" "$RECEIPT_FILES" | tee "$ROOT/.yogurt/backups/last-restore-verification.json"
