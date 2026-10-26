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
