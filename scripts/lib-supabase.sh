# Shared by the Supabase scripts (source after lib-env.sh, with WORK set to a scratch folder).
# supabase_target sets TARGET to the Supabase link with the password percent-encoded, session mode
# and SSL required. It reuses .yogurt/supabase.env when the person presses Return.
# The link and password are never printed.
SUPABASE_SAVED="$ROOT/.yogurt/supabase.env"
PATH="$(pg_client_path)$PATH"
export PATH

supabase_target() {
  TARGET=""
  if [ -z "${SUPABASE_URL_RAW:-}" ] && [ -f "$SUPABASE_SAVED" ]; then
    echo "พบลิงก์ Supabase ที่บันทึกไว้ครั้งก่อน: กด Return เพื่อใช้อันเดิม หรือพิมพ์ new แล้วกด Return เพื่อใส่ใหม่"
    read -r _answer
    [ "$_answer" = "new" ] || TARGET="$(sed -n 's/^DATABASE_URL="\(.*\)"$/\1/p' "$SUPABASE_SAVED")"
  fi
  if [ -z "$TARGET" ]; then
    _raw="${SUPABASE_URL_RAW:-}"
    _pw="${SUPABASE_PASSWORD:-}"
    if [ -z "$_raw" ]; then
      echo
      echo "1) วางลิงก์จาก Supabase (ปุ่ม Connect → Session pooler) แล้วกด Return:"
      IFS= read -r _raw
    fi
    if [ -z "$_pw" ] && printf '%s' "$_raw" | grep -qF '[YOUR-PASSWORD]'; then
      echo "2) วางรหัสผ่านฐานข้อมูล Supabase (ตัวอักษรจะไม่แสดงบนจอ) แล้วกด Return:"
      IFS= read -rs _pw
      echo
    fi
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
    ' "$_raw" "$_pw")" || { TARGET=""; return 2; }
    unset _pw
  fi
  echo
  echo "กำลังเชื่อมต่อ Supabase..."
  if ! SUPABASE_VERSION="$(psql "$TARGET" -v ON_ERROR_STOP=1 -Atc "SHOW server_version" 2>"$WORK/connect.err")"; then
    grep -v -i "password=" "$WORK/connect.err" | tail -n 3
    return 3
  fi
  echo "เชื่อมต่อได้: PostgreSQL $SUPABASE_VERSION"
  mkdir -p "$ROOT/.yogurt"
  ( umask 077; printf 'DATABASE_URL="%s"\n' "$TARGET" > "$SUPABASE_SAVED" )
  chmod 600 "$SUPABASE_SAVED"
}

# Row count of every table, one "table count" line each, for comparing two databases.
TABLE_COUNTS_SQL="SELECT table_name || ' ' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1"

# Drops every table and enum type in the public schema of the database at $1.
wipe_public_schema() {
  psql "$1" -v ON_ERROR_STOP=1 -q <<'SQL'
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
}

# Copies every table from the database at $1 into the (empty) database at $2.
copy_database() {
  dump_application_database "$WORK/copy.dump" "$1" || return 1
  # Supabase already has the public schema and its extensions; restore only our own objects.
  pg_restore -l "$WORK/copy.dump" > "$WORK/copy.list.raw" || return 1
  grep -v -E '^[0-9]+; [0-9]+ [0-9]+ (SCHEMA|EXTENSION|COMMENT) ' "$WORK/copy.list.raw" > "$WORK/copy.list" || return 1
  pg_restore --no-owner --no-acl --exit-on-error -L "$WORK/copy.list" -d "$2" "$WORK/copy.dump" 2>"$WORK/restore.err" || { tail -n 5 "$WORK/restore.err"; return 1; }
  DATABASE_URL="$2" node "$ROOT/scripts/harden-supabase-api.mjs" || return 1
}
