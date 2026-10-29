# Shared by the shell scripts. Source it after setting ROOT:
#   . "$ROOT/scripts/lib-env.sh"
# env_value NAME prints the setting from the environment, or else from $ROOT/.env (quotes removed).
env_value() {
  _value=$(printenv "$1" 2>/dev/null || true)
  if [ -n "$_value" ]; then printf '%s' "$_value"; return 0; fi
  [ -f "$ROOT/.env" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ROOT/.env" | tail -n 1 | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# The installed app's mutable files can live outside the repository. Never resolve a relative override.
runtime_data_directory() {
  if [ "${YOGURT_DATA_ROOT+x}" != x ]; then printf '%s' "$ROOT/.yogurt"; return 0; fi
  case "$YOGURT_DATA_ROOT" in
    /*) printf '%s' "$YOGURT_DATA_ROOT" ;;
    *) echo "YOGURT_DATA_ROOT must be an absolute path" >&2; return 2 ;;
  esac
}

# DATABASE_URL without Prisma's ?schema=... part, which psql and pg_dump do not accept.
database_url() {
  postgres_database_url "$(env_value DATABASE_URL)"
}

# The PostgreSQL server on this Mac, for scratch databases (restore checks, tests). After the move to
# Supabase it is LOCAL_DATABASE_URL; before that DATABASE_URL is itself on this Mac.
local_database_url() {
  _local=$(env_value LOCAL_DATABASE_URL)
  if [ -n "$_local" ]; then postgres_database_url "$_local"; else database_url; fi
}

# Newer PostgreSQL client tools (Homebrew libpq), to put first in PATH: pg_dump must be at least as new
# as the server it dumps (Supabase runs a newer PostgreSQL than the one on this Mac).
pg_client_path() {
  for _dir in /opt/homebrew/opt/libpq/bin /usr/local/opt/libpq/bin; do
    if [ -x "$_dir/pg_dump" ]; then printf '%s:' "$_dir"; fi
  done
}

# Remove only Prisma-only URL parameters; keep PostgreSQL SSL and connection options.
postgres_database_url() {
  [ -n "$1" ] || return 0
  node -e 'try{const u=new URL(process.argv[1]);if(!/^postgres(ql)?:$/.test(u.protocol))throw Error();const overrides=["host","hostaddr","port","dbname","user","password","service","servicefile"];if([...u.searchParams.keys()].some(k=>overrides.includes(k.toLowerCase()))||["PGHOSTADDR","PGSERVICE","PGSERVICEFILE"].some(k=>process.env[k]))throw Error();if(!u.port)u.port="5432";for(const k of ["schema","connection_limit","pool_timeout","pgbouncer","socket_timeout"])u.searchParams.delete(k);process.stdout.write(u.toString())}catch{console.error("Invalid PostgreSQL database URL");process.exit(2)}' "$1"
}

# Scratch databases must stay on this computer, even if LOCAL_DATABASE_URL was set incorrectly.
assert_local_database_url() {
  node -e 'try{const u=new URL(process.argv[1]);if(!/^postgres(ql)?:$/.test(u.protocol)||!["127.0.0.1","localhost","[::1]"].includes(u.hostname)||[...u.searchParams.keys()].some(k=>["host","hostaddr","port","dbname","user","password","service","servicefile"].includes(k.toLowerCase()))||["PGHOSTADDR","PGSERVICE","PGSERVICEFILE"].some(k=>process.env[k]))throw Error()}catch{console.error("Scratch database maintenance URL must point to localhost");process.exit(2)}' "$1"
}

database_named_url() {
  node -e 'const u=new URL(process.argv[1]);u.pathname="/"+process.argv[2];process.stdout.write(u.toString())' "$1" "$2"
}

# Connection failures have a bounded retry budget; no SQL writes are retried here.
retry_database_read() {
  _attempt=1
  _limit=${DB_RETRY_ATTEMPTS:-3}
  case "$_limit" in 1|2|3|4|5) ;; *) echo "DB_RETRY_ATTEMPTS must be 1–5" >&2; return 2 ;; esac
  _delay=${DB_RETRY_DELAY_SECONDS:-2}
  case "$_delay" in 0|1|2|3|4|5|10|15|30) ;; *) echo "Invalid DB retry delay" >&2; return 2 ;; esac
  while :; do
    if PGCONNECT_TIMEOUT=10 "$@"; then return 0; else _rc=$?; fi
    [ "$_attempt" -lt "$_limit" ] || return "$_rc"
    echo "Database read failed; retrying ($_attempt/$_limit)" >&2
    sleep "$_delay"
    _attempt=$((_attempt + 1))
  done
}

# The application owns public. Provider schemas, extensions and publications are excluded.
# --exclude-extension requires PostgreSQL 17+ clients (the libpq client used for Supabase).
dump_application_database() {
  retry_database_read pg_dump --format=custom --compress=6 --no-owner --no-acl --schema=public --exclude-extension='*' --no-publications --no-subscriptions --no-security-labels --lock-wait-timeout=30000 --file="$1" "$2"
}

# Restore in separate steps so a failed pg_restore/SQL filter cannot disappear in a pipeline.
restore_dump_sql() (
  umask 077
  _sql="$(mktemp "${TMPDIR:-/tmp}/yogurt-restore-XXXXXX")" || return 1
  trap 'rm -f "$_sql" "$_sql.compat" "$_sql.toc" "$_sql.list"' 0
  pg_restore --list "$1" > "$_sql.toc" || return 1
  # A newly created PostgreSQL database already has public. Keep its app types/tables/data.
  awk '!/^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public( |$)/' "$_sql.toc" > "$_sql.list" || return 1
  pg_restore --no-owner --no-acl --use-list="$_sql.list" --file="$_sql" "$1" || return 1
  sed '/^SET transaction_timeout[ =]/d' "$_sql" > "$_sql.compat" || return 1
  psql "$2" -v ON_ERROR_STOP=1 -q -f "$_sql.compat" >/dev/null
)

verify_backup_checksum() {
  [ -f "$1" ] && [ -f "$1.sha256" ] || { echo "Backup or checksum missing" >&2; return 2; }
  _expected=$(awk 'NR==1 {print $1}' "$1.sha256")
  _actual=$(shasum -a 256 "$1" | awk '{print $1}')
  [ -n "$_expected" ] && [ "$_expected" = "$_actual" ] || { echo "Backup checksum mismatch" >&2; return 2; }
  node "$ROOT/scripts/backup-state.mjs" check "$(dirname "$1")" "$1"
}

verify_restored_invariants() {
  RESTORE_COUNTS=$(psql "$1" -v ON_ERROR_STOP=1 -Atc "SELECT json_build_object('users',(SELECT count(*) FROM users),'stores',(SELECT count(*) FROM stores),'materials',(SELECT count(*) FROM raw_materials),'settlements',(SELECT count(*) FROM settlements),'auditLogs',(SELECT count(*) FROM audit_logs));") || return 1
  for _query in \
    "SELECT count(*) FROM raw_materials WHERE current_stock < 0;" \
    "SELECT count(*) FROM fridge_inventory WHERE current_stock < 0;" \
    "SELECT count(*) FROM production_batches WHERE quantity_produced <= 0 OR quantity_remaining < 0 OR quantity_remaining > quantity_produced OR total_material_cost < 0 OR unit_cost < 0 OR exp_date < mfg_date;" \
    "SELECT count(*) FROM settlements WHERE gross_amount < 0 OR store_commission_amount < 0 OR net_payable_amount < 0 OR previous_balance < 0 OR paid_amount < 0 OR closing_balance < 0 OR store_commission_amount > gross_amount OR net_payable_amount > gross_amount;"
  do
    _invalid=$(psql "$1" -v ON_ERROR_STOP=1 -Atc "$_query") || return 1
    [ "$_invalid" = "0" ] || { echo "Restored database failed financial/stock invariants" >&2; return 3; }
  done
  RESTORE_RECEIPT_FILES=0
  _receipts="${2%.dump}.receipts.tar.gz"
  if [ -f "$_receipts" ]; then
    [ -f "$_receipts.sha256" ] && [ "$(awk 'NR==1 {print $1}' "$_receipts.sha256")" = "$(shasum -a 256 "$_receipts" | awk '{print $1}')" ] || { echo "Receipt archive checksum mismatch" >&2; return 2; }
    _receipt_list=$(tar -tzf "$_receipts") || return 1
    RESTORE_RECEIPT_FILES=$(printf '%s\n' "$_receipt_list" | grep -c '^private-receipts/.' || true)
  fi
  RESTORE_COUNTS="$RESTORE_COUNTS" RESTORE_RECEIPT_FILES="$RESTORE_RECEIPT_FILES" node "$ROOT/scripts/backup-state.mjs" restore-success "$(dirname "$2")" "$2"
}
