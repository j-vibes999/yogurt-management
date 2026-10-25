#!/bin/sh
set -eu
ROOT="/Users/justkay/Projects/Yogurt_Super_Web"
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
cd "$ROOT"
fail(){ code="$1"; shift; msg="$*"; echo "$msg" >&2; "$ROOT/scripts/send-alert.sh" error backup.restore_verification_failed "$msg" >/dev/null 2>&1 || true; exit "$code"; }
BACKUP=${1:-$(ls -1t "$ROOT"/.yogurt/backups/yogurt_ops-*.dump 2>/dev/null | head -1)}
[ -n "$BACKUP" ] || fail 2 "No backup found"
CHECKSUM="$BACKUP.sha256"
[ -f "$CHECKSUM" ] || fail 2 "Missing checksum: $CHECKSUM"
EXPECTED_HASH=$(awk 'NR==1 {print $1}' "$CHECKSUM")
ACTUAL_HASH=$(shasum -a 256 "$BACKUP" | awk '{print $1}')
[ -n "$EXPECTED_HASH" ] && [ "$EXPECTED_HASH" = "$ACTUAL_HASH" ] || fail 2 "Backup checksum mismatch: $BACKUP"
DBURL=$(node -e "require('dotenv').config({path:'.env'}); const u=new URL(process.env.DATABASE_URL); u.search=''; process.stdout.write(u.toString())")
ADMINURL=$(node -e "require('dotenv').config({path:'.env'}); const u=new URL(process.env.DATABASE_URL); u.search=''; u.pathname='/postgres'; process.stdout.write(u.toString())")
NAME="yogurt_restore_verify_$(date '+%Y%m%d%H%M%S')_$$"
RESTOREURL=$(node -e "const u=new URL(process.argv[1]); u.pathname='/'+process.argv[2]; process.stdout.write(u.toString())" "$DBURL" "$NAME")
cleanup(){ rc=$?; psql "$ADMINURL" -v ON_ERROR_STOP=0 -c "DROP DATABASE IF EXISTS \"$NAME\" WITH (FORCE);" >/dev/null 2>&1 || true; [ "$rc" -eq 0 ] || "$ROOT/scripts/send-alert.sh" error backup.restore_verification_failed "Restore verification failed (exit $rc)" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
psql "$ADMINURL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$NAME\";" >/dev/null
pg_restore --no-owner --no-acl --exit-on-error --dbname="$RESTOREURL" "$BACKUP"
RESULT=$(psql "$RESTOREURL" -Atc "SELECT json_build_object('users',(SELECT count(*) FROM users),'stores',(SELECT count(*) FROM stores),'materials',(SELECT count(*) FROM raw_materials),'settlements',(SELECT count(*) FROM settlements),'auditLogs',(SELECT count(*) FROM audit_logs));")
RAW_NEG=$(psql "$RESTOREURL" -Atc "SELECT count(*) FROM raw_materials WHERE current_stock < 0;")
FRIDGE_NEG=$(psql "$RESTOREURL" -Atc "SELECT count(*) FROM fridge_inventory WHERE current_stock < 0;")
BATCH_INVALID=$(psql "$RESTOREURL" -Atc "SELECT count(*) FROM production_batches WHERE quantity_produced <= 0 OR quantity_remaining < 0 OR quantity_remaining > quantity_produced OR total_material_cost < 0 OR unit_cost < 0 OR exp_date < mfg_date;")
SETTLEMENT_INVALID=$(psql "$RESTOREURL" -Atc "SELECT count(*) FROM settlements WHERE gross_amount < 0 OR store_commission_amount < 0 OR net_payable_amount < 0 OR previous_balance < 0 OR paid_amount < 0 OR closing_balance < 0 OR store_commission_amount > gross_amount OR net_payable_amount > gross_amount;")
[ "$RAW_NEG" = "0" ] || fail 3 "restored DB has negative raw stock"
[ "$FRIDGE_NEG" = "0" ] || fail 3 "restored DB has negative fridge stock"
[ "$BATCH_INVALID" = "0" ] || fail 3 "restored DB has invalid production batch quantities/costs"
[ "$SETTLEMENT_INVALID" = "0" ] || fail 3 "restored DB has invalid settlement amounts"
printf '{"ok":true,"backup":"%s","verifiedAt":"%s","counts":%s}\n' "$(basename "$BACKUP")" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$RESULT" | tee "$ROOT/.yogurt/backups/last-restore-verification.json"
