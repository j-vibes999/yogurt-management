#!/bin/bash
# Copies the Yogurt database from this Mac to a Supabase (PostgreSQL) project and checks
# that every table has the same number of rows on both sides.
# The website keeps using the database on this Mac: nothing is switched over.
# Running it again replaces everything in the Supabase database with a fresh copy.
# The Supabase connection string is kept in .yogurt/supabase.env (readable only by this user).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib-env.sh"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$ROOT" || exit 1
SAVED="$ROOT/.yogurt/supabase.env"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/yogurt-supabase-XXXXXX")" || exit 1
trap 'rm -rf "$WORK"' EXIT
fail() { echo; echo "ไม่สำเร็จ: $*"; echo "ข้อมูลบน Mac ไม่ได้ถูกแก้ไข เว็บยังใช้งานได้ตามปกติ"; exit 1; }

for tool in node psql pg_dump pg_restore; do command -v "$tool" >/dev/null 2>&1 || fail "ไม่พบโปรแกรม $tool"; done
LOCAL="$(database_url)"
[ -n "$LOCAL" ] || fail "ไม่พบ DATABASE_URL ใน .env"
echo "=== คัดลอกฐานข้อมูลไป Supabase · $(date) ==="

TARGET=""
if [ -z "${SUPABASE_URL_RAW:-}" ] && [ -f "$SAVED" ]; then
  echo "พบลิงก์ Supabase ที่บันทึกไว้ครั้งก่อน: กด Return เพื่อใช้อันเดิม หรือพิมพ์ new แล้วกด Return เพื่อใส่ใหม่"
  read -r ANSWER
  [ "$ANSWER" = "new" ] || TARGET="$(sed -n 's/^DATABASE_URL="\(.*\)"$/\1/p' "$SAVED")"
fi

if [ -z "$TARGET" ]; then
  RAW="${SUPABASE_URL_RAW:-}"
  PW="${SUPABASE_PASSWORD:-}"
  if [ -z "$RAW" ]; then
    echo
    echo "1) วางลิงก์จาก Supabase (ปุ่ม Connect → Session pooler) แล้วกด Return:"
    IFS= read -r RAW
  fi
  if [ -z "$PW" ] && printf '%s' "$RAW" | grep -qF '[YOUR-PASSWORD]'; then
    echo "2) วางรหัสผ่านฐานข้อมูล Supabase (ตัวอักษรจะไม่แสดงบนจอ) แล้วกด Return:"
    IFS= read -rs PW
    echo
  fi
  # Puts the password into the link (percent-encoded), keeps a session connection and requires SSL.
  TARGET="$(node -e '
    const [raw, pw] = process.argv.slice(1);
    let s = raw.trim().replace(/^["\x27]|["\x27]$/g, "");
    if (s.includes("[YOUR-PASSWORD]")) {
      if (!pw) { console.error("no password"); process.exit(2); }
      s = s.replace("[YOUR-PASSWORD]", encodeURIComponent(pw));
    }
    const u = new URL(s);
    if (!/^postgres(ql)?:$/.test(u.protocol)) { console.error("not a postgresql link"); process.exit(2); }
    if (!/(^|\.)supabase\.(co|com)$/.test(u.hostname) && !process.env.SUPABASE_ALLOW_ANY_HOST) { console.error("not a Supabase host"); process.exit(2); }
    if (u.port === "6543") { u.port = "5432"; console.error("note: transaction pooler port 6543 changed to session pooler port 5432"); }
    u.searchParams.delete("pgbouncer");
    if (!u.searchParams.has("sslmode")) u.searchParams.set("sslmode", "require");
    process.stdout.write(u.toString());
  ' "$RAW" "$PW")" || fail "ลิงก์ไม่ถูกต้อง: ให้คัดลอกลิงก์ที่ขึ้นต้นด้วย postgresql:// จาก Connect → Session pooler"
fi

echo
echo "กำลังเชื่อมต่อ Supabase..."
if ! VERSION="$(psql "$TARGET" -v ON_ERROR_STOP=1 -Atc "SHOW server_version" 2>"$WORK/connect.err")"; then
  grep -v -i "password=" "$WORK/connect.err" | tail -n 3
  fail "เชื่อมต่อ Supabase ไม่ได้: ตรวจรหัสผ่าน และใช้ลิงก์แบบ Session pooler (แบบ Direct ใช้ไม่ได้กับอินเทอร์เน็ตส่วนใหญ่)"
fi
echo "เชื่อมต่อได้: PostgreSQL $VERSION"
mkdir -p "$ROOT/.yogurt"
( umask 077; printf 'DATABASE_URL="%s"\n' "$TARGET" > "$SAVED" )
chmod 600 "$SAVED"

EXISTING="$(psql "$TARGET" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")" || fail "อ่านรายการตารางใน Supabase ไม่ได้"
if [ "$EXISTING" != "0" ]; then
  echo
  echo "ฐานข้อมูล Supabase มีอยู่แล้ว $EXISTING ตาราง"
  if [ "${SUPABASE_REPLACE:-}" != "yes" ]; then
    echo "พิมพ์ yes แล้วกด Return เพื่อลบข้อมูลใน Supabase ทั้งหมด แล้วคัดลอกชุดใหม่จาก Mac (อย่างอื่นคือยกเลิก):"
    read -r ANSWER
    [ "$ANSWER" = "yes" ] || fail "ยกเลิกแล้ว"
  fi
fi

echo
echo "1/4 · อ่านข้อมูลจาก Mac"
pg_dump -Fc --no-owner --no-acl -f "$WORK/yogurt.dump" "$LOCAL" || fail "อ่านฐานข้อมูลบน Mac ไม่ได้"
# Supabase already has the public schema and its extensions; restore only our own objects.
pg_restore -l "$WORK/yogurt.dump" | grep -v -E '^[0-9]+; [0-9]+ [0-9]+ (SCHEMA|EXTENSION|COMMENT) ' > "$WORK/toc.list"

if [ "$EXISTING" != "0" ]; then
  echo "2/4 · ลบข้อมูลชุดเก่าใน Supabase"
  psql "$TARGET" -v ON_ERROR_STOP=1 -q <<'SQL' || fail "ลบข้อมูลชุดเก่าใน Supabase ไม่ได้"
SET client_min_messages = warning;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;
END $$;
SQL
else
  echo "2/4 · Supabase ยังว่าง ไม่ต้องลบอะไร"
fi

echo "3/4 · เขียนข้อมูลลง Supabase"
pg_restore --no-owner --no-acl --exit-on-error -L "$WORK/toc.list" -d "$TARGET" "$WORK/yogurt.dump" 2>"$WORK/restore.err" || { tail -n 5 "$WORK/restore.err"; fail "เขียนข้อมูลลง Supabase ไม่ครบ (ส่งไฟล์ .yogurt/supabase-copy.log ให้ผู้ดูแล)"; }

echo "4/4 · ตรวจว่าข้อมูลตรงกันทุกตาราง"
COUNT_SQL="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"
psql "$LOCAL" -v ON_ERROR_STOP=1 -Atc "$COUNT_SQL" > "$WORK/mac.txt" || fail "นับข้อมูลบน Mac ไม่ได้"
psql "$TARGET" -v ON_ERROR_STOP=1 -Atc "$COUNT_SQL" > "$WORK/supabase.txt" || fail "นับข้อมูลใน Supabase ไม่ได้"
if ! diff "$WORK/mac.txt" "$WORK/supabase.txt" > "$WORK/diff.txt"; then
  cat "$WORK/diff.txt"
  fail "จำนวนข้อมูลไม่ตรงกัน"
fi
TABLES="$(wc -l < "$WORK/mac.txt" | tr -d ' ')"
ROWS="$(awk '{s += $2} END {print s + 0}' "$WORK/mac.txt")"
echo
echo "=== เสร็จแล้ว: คัดลอก $TABLES ตาราง รวม $ROWS แถว ตรงกันทุกตาราง ==="
echo "เว็บยังใช้ฐานข้อมูลบน Mac เหมือนเดิม (Supabase เป็นสำเนา ยังไม่ได้สลับไปใช้)"
echo "ลิงก์ Supabase บันทึกไว้ที่ .yogurt/supabase.env"
