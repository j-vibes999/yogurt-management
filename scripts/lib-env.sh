# Shared by the shell scripts. Source it after setting ROOT:
#   . "$ROOT/scripts/lib-env.sh"
# env_value NAME prints the setting from the environment, or else from $ROOT/.env (quotes removed).
env_value() {
  _value=$(printenv "$1" 2>/dev/null || true)
  if [ -n "$_value" ]; then printf '%s' "$_value"; return 0; fi
  [ -f "$ROOT/.env" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ROOT/.env" | tail -n 1 | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# DATABASE_URL without Prisma's ?schema=... part, which psql and pg_dump do not accept.
database_url() {
  env_value DATABASE_URL | sed 's/?.*//'
}

# The PostgreSQL server on this Mac, for scratch databases (restore checks, tests). After the move to
# Supabase it is LOCAL_DATABASE_URL; before that DATABASE_URL is itself on this Mac.
local_database_url() {
  _local=$(env_value LOCAL_DATABASE_URL | sed 's/?.*//')
  if [ -n "$_local" ]; then printf '%s' "$_local"; else database_url; fi
}

# Newer PostgreSQL client tools (Homebrew libpq), to put first in PATH: pg_dump must be at least as new
# as the server it dumps (Supabase runs a newer PostgreSQL than the one on this Mac).
pg_client_path() {
  for _dir in /opt/homebrew/opt/libpq/bin /usr/local/opt/libpq/bin; do
    if [ -x "$_dir/pg_dump" ]; then printf '%s:' "$_dir"; fi
  done
}

# Restores a custom-format dump ($1) into the database at $2 through plain SQL, so that a dump made by
# newer tools also loads into the older server on this Mac (it drops the settings that server lacks).
restore_dump_sql() {
  _sql="$(mktemp "${TMPDIR:-/tmp}/yogurt-restore-XXXXXX")" || return 1
  if pg_restore --no-owner --no-acl --file="$_sql" "$1" && grep -v -E '^SET transaction_timeout' "$_sql" | psql "$2" -v ON_ERROR_STOP=1 -q >/dev/null; then
    rm -f "$_sql"; return 0
  fi
  rm -f "$_sql"; return 1
}
