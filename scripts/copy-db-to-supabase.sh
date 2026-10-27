#!/bin/bash
# Copies the Yogurt database from this Mac to a Supabase (PostgreSQL) project and checks
# that every table has the same number of rows on both sides.
# The website keeps using the database on this Mac: nothing is switched over.
# Running it again replaces everything in the Supabase database with a fresh copy.
# The Supabase connection string is kept in .yogurt/supabase.env (readable only by this user).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
. "$ROOT/scripts/lib-env.sh"
cd "$ROOT" || exit 1
WORK="$(mktemp -d "${TMPDIR:-/tmp}/yogurt-supabase-XXXXXX")" || exit 1
trap 'rm -rf "$WORK"' EXIT
. "$ROOT/scripts/lib-supabase.sh"
fail() { echo; echo "ไม่สำเร็จ: $*"; echo "ข้อมูลบน Mac ไม่ได้ถูกแก้ไข เว็บยังใช้งานได้ตามปกติ"; exit 1; }

for tool in node psql pg_dump pg_restore; do command -v "$tool" >/dev/null 2>&1 || fail "ไม่พบโปรแกรม $tool"; done
grep -q '^LOCAL_DATABASE_URL=' .env 2>/dev/null && fail "เว็บใช้ Supabase อยู่แล้ว: การคัดลอกจาก Mac จะเขียนทับข้อมูลจริง"
LOCAL="$(database_url)"
[ -n "$LOCAL" ] || fail "ไม่พบ DATABASE_URL ใน .env"
echo "=== คัดลอกฐานข้อมูลไป Supabase · $(date) ==="
supabase_target || fail "เชื่อมต่อ Supabase ไม่ได้: ตรวจรหัสผ่าน และใช้ลิงก์แบบ Session pooler ที่ขึ้นต้นด้วย postgresql://"

EXISTING="$(psql "$TARGET" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" || fail "อ่านรายการตารางใน Supabase ไม่ได้"
if [ "$EXISTING" != "0" ]; then
  echo
  echo "ฐานข้อมูล Supabase มีอยู่แล้ว $EXISTING ตาราง"
  if [ "${SUPABASE_REPLACE:-}" != "yes" ]; then
    echo "พิมพ์ yes แล้วกด Return เพื่อลบข้อมูลใน Supabase ทั้งหมด แล้วคัดลอกชุดใหม่จาก Mac (อย่างอื่นคือยกเลิก):"
    read -r ANSWER
    [ "$ANSWER" = "yes" ] || fail "ยกเลิกแล้ว"
  fi
  echo "ลบข้อมูลชุดเก่าใน Supabase"
  wipe_public_schema "$TARGET" || fail "ลบข้อมูลชุดเก่าใน Supabase ไม่ได้"
fi

echo "คัดลอกข้อมูลจาก Mac ไป Supabase"
copy_database "$LOCAL" "$TARGET" || fail "เขียนข้อมูลลง Supabase ไม่ครบ (ส่งไฟล์ .yogurt/supabase-copy.log ให้ผู้ดูแล)"

echo "ตรวจว่าข้อมูลตรงกันทุกตาราง"
psql "$LOCAL" -v ON_ERROR_STOP=1 -Atc "$TABLE_COUNTS_SQL" > "$WORK/mac.txt" || fail "นับข้อมูลบน Mac ไม่ได้"
psql "$TARGET" -v ON_ERROR_STOP=1 -Atc "$TABLE_COUNTS_SQL" > "$WORK/supabase.txt" || fail "นับข้อมูลใน Supabase ไม่ได้"
diff "$WORK/mac.txt" "$WORK/supabase.txt" || fail "จำนวนข้อมูลไม่ตรงกัน"
echo
echo "=== เสร็จแล้ว: คัดลอก $(wc -l < "$WORK/mac.txt" | tr -d ' ') ตาราง รวม $(awk '{s += $2} END {print s + 0}' "$WORK/mac.txt") แถว ตรงกันทุกตาราง ==="
echo "เว็บยังใช้ฐานข้อมูลบน Mac เหมือนเดิม (Supabase เป็นสำเนา ยังไม่ได้สลับไปใช้)"
