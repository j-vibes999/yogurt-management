#!/bin/bash
# Moves the website to a Supabase database and starts it fresh, keeping only the set-up data:
# user accounts, products and selling prices, recipes, raw materials with their cost per unit
# (stock set to 0) and expense categories. Stores, fridges, production, refills, store checks,
# payments, expenses and the audit log start empty.
#   1. full backup of the database on this Mac (kept in .yogurt/backups; the Mac database is not changed)
#   2. stop the website  3. copy to Supabase  4. clear everything but the set-up data
#   5. point .env at Supabase (the old link is kept as LOCAL_DATABASE_URL)  6. start and check.
# If the website does not come back, .env is put back and the website runs on the Mac database again.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
. "$ROOT/scripts/lib-env.sh"
cd "$ROOT" || exit 1
WORK="$(mktemp -d "${TMPDIR:-/tmp}/yogurt-move-XXXXXX")" || exit 1
STATE="$ROOT/.yogurt"
PORT="${YOGURT_PORT:-3000}"
SERVER_CONTROL="${YOGURT_SERVER_CONTROL:-$ROOT/scripts/server-control.sh}"
STOPPED=0
finish() { rm -rf "$WORK"; rm -f "$STATE/maintenance"; }
trap finish EXIT
. "$ROOT/scripts/lib-supabase.sh"
fail() {
  echo; echo "ไม่สำเร็จ: $*"
  if [ "$STOPPED" = 1 ]; then "$SERVER_CONTROL" start >/dev/null 2>&1 && echo "เปิดเว็บกลับมาแล้ว (ยังใช้ฐานข้อมูลบน Mac)"; fi
  echo "ข้อมูลบน Mac ไม่ได้ถูกแก้ไข"; exit 1
}
KEEP="'_prisma_migrations','users','finished_products','recipes','recipe_items','raw_materials','expense_categories'"

for tool in node psql pg_dump pg_restore; do command -v "$tool" >/dev/null 2>&1 || fail "ไม่พบโปรแกรม $tool"; done
grep -q '^LOCAL_DATABASE_URL=' .env 2>/dev/null && fail "เว็บย้ายไป Supabase แล้ว (.env มี LOCAL_DATABASE_URL อยู่แล้ว)"
LOCAL="$(database_url)"
[ -n "$LOCAL" ] || fail "ไม่พบ DATABASE_URL ใน .env"
echo "=== ย้ายเว็บไปใช้ Supabase · $(date) ==="
supabase_target || fail "เชื่อมต่อ Supabase ไม่ได้: ตรวจรหัสผ่าน และใช้ลิงก์แบบ Session pooler ที่ขึ้นต้นด้วย postgresql://"

# Nightly backups dump the Supabase database from now on: pg_dump must be at least its version.
SERVER_MAJOR="$(psql "$TARGET" -Atc "SHOW server_version_num" | cut -c1-2)"
need_client() { PATH="$(pg_client_path)$PATH" pg_dump --version | sed 's/[^0-9]*\([0-9][0-9]*\).*/\1/'; }
if [ "$(need_client)" -lt "$SERVER_MAJOR" ]; then
  echo "ติดตั้งเครื่องมือ PostgreSQL รุ่นใหม่ (libpq) สำหรับสำรองข้อมูลจาก Supabase..."
  command -v brew >/dev/null 2>&1 || fail "ไม่พบ Homebrew สำหรับติดตั้ง libpq"
  installed=0
  for attempt in 1 2 3; do
    HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install libpq >/dev/null 2>"$WORK/brew.err" && { installed=1; break; }
    tail -n 2 "$WORK/brew.err"; echo "ลองใหม่ ($attempt/3)..."; sleep 5
  done
  [ "$installed" = 1 ] || fail "ติดตั้ง libpq ไม่สำเร็จ (อินเทอร์เน็ต?)"
  [ "$(need_client)" -ge "$SERVER_MAJOR" ] || fail "pg_dump ยังเก่ากว่า Supabase"
fi

EXISTING="$(psql "$TARGET" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" || fail "อ่านรายการตารางใน Supabase ไม่ได้"
echo
echo "จะเก็บไว้: บัญชีผู้ใช้, สินค้าและราคาขาย, สูตรการผลิต, วัตถุดิบและต้นทุนต่อหน่วย (สต็อกเป็น 0), หมวดรายจ่าย"
echo "จะเริ่มใหม่: ร้าน, ตู้แช่, การผลิต, การเติมสินค้า, การตรวจร้าน, การรับเงิน, รายจ่าย, ประวัติ"
[ "$EXISTING" = "0" ] || echo "ข้อมูลที่มีอยู่ใน Supabase ($EXISTING ตาราง) จะถูกลบ"
echo "ข้อมูลเก่าทั้งหมดยังอยู่ในไฟล์สำรองและในฐานข้อมูลบน Mac"
if [ "${SUPABASE_CONFIRM:-}" != "yes" ]; then
  echo "พิมพ์ yes แล้วกด Return เพื่อเริ่ม (อย่างอื่นคือยกเลิก):"
  read -r ANSWER
  [ "$ANSWER" = "yes" ] || fail "ยกเลิกแล้ว"
fi

echo
echo "1/6 · สำรองข้อมูลบน Mac"
BACKUP_LINE="$("$ROOT/scripts/backup-db.sh" 2>"$WORK/backup.err" | tail -n 1)" || { tail -n 5 "$WORK/backup.err"; fail "สำรองข้อมูลไม่สำเร็จ"; }
[ -f "$BACKUP_LINE" ] || fail "สำรองข้อมูลไม่สำเร็จ"
echo "   $BACKUP_LINE"

echo "2/6 · ปิดเว็บชั่วคราว"
date +%s > "$STATE/maintenance"
"$SERVER_CONTROL" stop >/dev/null || fail "ปิดเว็บไม่ได้"
STOPPED=1

echo "3/6 · คัดลอกไป Supabase"
if [ "$EXISTING" != "0" ]; then wipe_public_schema "$TARGET" || fail "ลบข้อมูลเก่าใน Supabase ไม่ได้"; fi
copy_database "$LOCAL" "$TARGET" || fail "คัดลอกไป Supabase ไม่สำเร็จ"

echo "4/6 · ล้างข้อมูลที่ไม่ใช้ เก็บเฉพาะข้อมูลตั้งต้น"
psql "$TARGET" -v ON_ERROR_STOP=1 -q <<SQL || fail "ล้างข้อมูลใน Supabase ไม่ได้"
SET client_min_messages = warning;
BEGIN;
DO \$\$
DECLARE tables text;
BEGIN
  SELECT string_agg(format('public.%I', tablename), ', ') INTO tables
  FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ($KEEP);
  IF tables IS NOT NULL THEN EXECUTE 'TRUNCATE ' || tables; END IF;
END \$\$;
UPDATE raw_materials SET current_stock = 0;
UPDATE users SET failed_login_count = 0, locked_until = NULL;
COMMIT;
SQL
psql "$LOCAL" -v ON_ERROR_STOP=1 -Atc "$TABLE_COUNTS_SQL" > "$WORK/mac.txt" || fail "นับข้อมูลบน Mac ไม่ได้"
psql "$TARGET" -v ON_ERROR_STOP=1 -Atc "$TABLE_COUNTS_SQL" > "$WORK/supabase.txt" || fail "นับข้อมูลใน Supabase ไม่ได้"
node -e '
  const fs = require("fs"); const keep = process.argv[3].replace(/\x27/g, "").split(",");
  const read = (f) => Object.fromEntries(fs.readFileSync(f, "utf8").trim().split("\n").map((l) => l.split(" ")).map(([t, c]) => [t, Number(c)]));
  const mac = read(process.argv[1]), sb = read(process.argv[2]); const bad = [];
  for (const t of Object.keys(mac)) { const want = keep.includes(t) ? mac[t] : 0; if (sb[t] !== want) bad.push(`${t}: ${sb[t]} (ควรเป็น ${want})`); }
  if (bad.length) { console.log(bad.join("\n")); process.exit(1); }
  for (const t of keep) if (mac[t] !== undefined) console.log(`   ${t}: ${sb[t]}`);
' "$WORK/mac.txt" "$WORK/supabase.txt" "$KEEP" || fail "ข้อมูลใน Supabase ไม่ตรงกับที่ควรเป็น"
[ "$(psql "$TARGET" -Atc "SELECT count(*) FROM raw_materials WHERE current_stock <> 0")" = "0" ] || fail "สต็อกวัตถุดิบยังไม่เป็น 0"

echo "5/6 · ตั้งเว็บให้ใช้ Supabase"
cp -p .env "$STATE/env-before-supabase"
APP_URL="$(node -e 'const u = new URL(process.argv[1]); if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", "5"); process.stdout.write(u.toString())' "$TARGET")"
node -e '
  const fs = require("fs"); const [file, url] = process.argv.slice(1);
  let s = fs.readFileSync(file, "utf8");
  const line = s.match(/^DATABASE_URL=.*$/m); if (!line) process.exit(1);
  s = s.replace(line[0], () => `LOCAL_DATABASE_URL=${line[0].slice("DATABASE_URL=".length)}\nDATABASE_URL="${url}"`);
  fs.writeFileSync(file, s, { mode: 0o600 });
' .env "$APP_URL" || fail "แก้ .env ไม่ได้"

echo "6/6 · เปิดเว็บและตรวจ"
ok=0
if "$SERVER_CONTROL" start >/dev/null; then
  for _ in $(seq 1 40); do
    curl -fsS --max-time 10 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"db":{"ok":true' && { ok=1; break; }
    sleep 3
  done
fi
if [ "$ok" != 1 ]; then
  echo "เว็บต่อ Supabase ไม่ได้ กำลังกลับไปใช้ฐานข้อมูลบน Mac..."
  "$SERVER_CONTROL" stop >/dev/null 2>&1
  cp -p "$STATE/env-before-supabase" .env
  fail "เว็บต่อ Supabase ไม่ได้"
fi
STOPPED=0
echo
echo "=== เสร็จแล้ว: เว็บใช้ฐานข้อมูล Supabase แล้ว ==="
echo "ข้อมูลเก่าทั้งหมดอยู่ในไฟล์สำรอง: $BACKUP_LINE"
echo "และในฐานข้อมูลบน Mac (LOCAL_DATABASE_URL ใน .env) ซึ่งเว็บไม่ได้ใช้แล้ว"
