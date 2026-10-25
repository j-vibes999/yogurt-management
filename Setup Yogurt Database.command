#!/bin/zsh
set -euo pipefail
export HOMEBREW_NO_AUTO_UPDATE=1

ROOT="$(cd "$(dirname "$0")" && pwd)"
STATE="$ROOT/.yogurt"
mkdir -p "$STATE"
cd "$ROOT"

exec > >(tee -a "$STATE/setup.log") 2>&1

echo "=== Yogurt Super Web — Full Setup / Verify ==="
echo "Started: $(date)"
echo

if [ -x /opt/homebrew/bin/brew ]; then
  BREW=/opt/homebrew/bin/brew
elif [ -x /usr/local/bin/brew ]; then
  BREW=/usr/local/bin/brew
else
  echo "Homebrew was not found. Install Homebrew from https://brew.sh and run this file again."
  read "_?Press Return to close..."
  exit 1
fi

if [ -x /usr/local/bin/node ]; then
  NODE=/usr/local/bin/node
elif [ -x /opt/homebrew/bin/node ]; then
  NODE=/opt/homebrew/bin/node
else
  NODE="$(command -v node || true)"
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "Node.js was not found."
  read "_?Press Return to close..."
  exit 1
fi

PRISMA="$ROOT/node_modules/prisma/build/index.js"
NEXT="$ROOT/node_modules/next/dist/bin/next"
if [ ! -f "$PRISMA" ] || [ ! -f "$NEXT" ]; then
  echo "node_modules is incomplete. Prisma or Next.js is missing."
  read "_?Press Return to close..."
  exit 1
fi

echo "1/10 · PostgreSQL 16"
PG_FORMULA="postgresql@16"
if ! "$BREW" list --versions "$PG_FORMULA" >/dev/null 2>&1; then
  echo "Installing $PG_FORMULA..."
  "$BREW" install "$PG_FORMULA"
else
  echo "$PG_FORMULA is already installed."
fi
PG_PREFIX="$($BREW --prefix "$PG_FORMULA")"
export PATH="$PG_PREFIX/bin:$($BREW --prefix)/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo
echo "2/10 · Start PostgreSQL as a background service"
"$BREW" services start "$PG_FORMULA" >/dev/null
READY=0
for i in {1..30}; do
  if "$PG_PREFIX/bin/pg_isready" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" -ne 1 ]; then
  echo "PostgreSQL did not become ready on port 5432."
  read "_?Press Return to close..."
  exit 1
fi

echo
echo "3/10 · Create/configure yogurt_ops"
if ! "$PG_PREFIX/bin/psql" -h 127.0.0.1 -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='yogurt_ops'" | grep -q 1; then
  "$PG_PREFIX/bin/createdb" -h 127.0.0.1 yogurt_ops
  echo "Created database yogurt_ops."
else
  echo "Database yogurt_ops already exists."
fi

DB_USER="$(id -un)"
export DATABASE_URL="postgresql://${DB_USER}@127.0.0.1:5432/yogurt_ops?schema=public"
TMP_ENV="$STATE/env.tmp"
if [ -f "$ROOT/.env" ]; then grep -v '^DATABASE_URL=' "$ROOT/.env" > "$TMP_ENV" || true; else : > "$TMP_ENV"; fi
{
  echo "DATABASE_URL=\"$DATABASE_URL\""
  cat "$TMP_ENV"
} > "$ROOT/.env"
rm -f "$TMP_ENV"
grep -q '^SESSION_SECRET=' "$ROOT/.env" || echo "SESSION_SECRET=\"$(openssl rand -base64 48 | tr -d '\n')\"" >> "$ROOT/.env"
grep -q '^ADMIN_EMAIL=' "$ROOT/.env" || echo 'ADMIN_EMAIL="owner@yogurt.local"' >> "$ROOT/.env"
grep -q '^ADMIN_PASSWORD=' "$ROOT/.env" || echo "ADMIN_PASSWORD=\"$(openssl rand -base64 24 | tr -d '\n')\"" >> "$ROOT/.env"
chmod 600 "$ROOT/.env"
echo "DATABASE_URL and secure local auth settings configured."

echo
echo "4/10 · Validate Prisma schema"
"$NODE" "$PRISMA" validate

echo
echo "5/10 · Regenerate Prisma Client and deploy migrations"
"$NODE" "$PRISMA" generate
"$NODE" "$PRISMA" migrate deploy

echo
echo "6/10 · Seed business data (fresh database only)"
"$NODE" --env-file="$ROOT/.env" "$ROOT/scripts/seed-if-empty.mjs"
"$NODE" --env-file="$ROOT/.env" "$ROOT/scripts/ensure-admin-password.mjs"

echo
echo "7/10 · Regression tests"
"$NODE" --test "$ROOT/tests/business.test.mjs" "$ROOT/tests/source-invariants.test.mjs"

echo
echo "8/10 · Next.js production build"
"$NODE" "$NEXT" build

echo
echo "9/10 · Database verification"
"$PG_PREFIX/bin/psql" -h 127.0.0.1 -d yogurt_ops -Atqc "SELECT 'stores=' || count(*) FROM stores; SELECT 'products=' || count(*) FROM finished_products; SELECT 'materials=' || count(*) FROM raw_materials; SELECT 'batches=' || count(*) FROM production_batches; SELECT 'refills=' || count(*) FROM refill_requests; SELECT 'settlements=' || count(*) FROM settlements;"

echo
echo "10/10 · Start Yogurt Web in the background"
chmod +x "$ROOT/Start Yogurt Web.command" "$ROOT/Stop Yogurt Web.command" "$ROOT/Yogurt Web Status.command"
/bin/zsh "$ROOT/Start Yogurt Web.command" --no-pause

echo
echo "=== FULL SETUP COMPLETE ==="
echo "PostgreSQL: ready on 127.0.0.1:5432"
echo "Database: yogurt_ops"
echo "Web: http://127.0.0.1:3000"
echo "Tests: passed"
echo "Next.js production build: passed"
echo "Setup log: $STATE/setup.log"
echo
echo "Use 'Yogurt Web Status.command' for status and 'Stop Yogurt Web.command' to stop only the web process."
read "_?Press Return to close..."
