#!/bin/bash
# Put the code in this folder into production:
#   tests -> database backup -> stop -> dependencies -> build -> database migration -> start -> check.
# If anything fails after the server was stopped, the previous build is put back and started again.
# The site is offline for the stop..start part (usually 1-3 minutes).
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
STATE="$ROOT/.yogurt"
ROLLBACK="$STATE/rollback"
PORT="${YOGURT_PORT:-3000}"
PRISMA="${YOGURT_PRISMA:-node node_modules/prisma/build/index.js}"
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
export NEXT_TELEMETRY_DISABLED=1
mkdir -p "$STATE"
cd "$ROOT" || exit 1
exec > >(tee -a "$STATE/update.log") 2>&1

pause() { [ -n "${YOGURT_NO_PAUSE:-}" ] || read -r -p "Press Return to close..." _; }
stop_here() { echo; echo "UPDATE NOT APPLIED: $*"; rm -f "$STATE/maintenance"; pause; exit 1; }

NPM_RAN=0
restore_previous() {
  echo
  echo "Putting the previous version back..."
  if [ "$NPM_RAN" = 1 ] && [ -d "$ROLLBACK/node_modules" ]; then rm -rf node_modules; mv "$ROLLBACK/node_modules" node_modules; fi
  if [ -d "$ROLLBACK/prisma-client" ]; then rm -rf node_modules/.prisma; cp -R "$ROLLBACK/prisma-client" node_modules/.prisma; fi
  if [ -d "$ROLLBACK/next" ]; then rm -rf .next; mv "$ROLLBACK/next" .next; fi
  if scripts/server-control.sh start; then echo "The previous version is running again."; else echo "The previous version did not start either. Run 'Yogurt Web Status.command' and send the output to your developer."; fi
}
give_up() { restore_previous; stop_here "$*"; }

check_site() {
  local code
  curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"db":{"ok":true' || { echo "  /api/health: database not OK"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:$PORT/login")"
  [ "$code" = "200" ] || { echo "  /login: HTTP $code"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:$PORT/reports")"
  [ "$code" = "307" ] || { echo "  /reports without login: HTTP $code (expected a redirect to login)"; return 1; }
  return 0
}

echo "=== Yogurt update · $(date) ==="
command -v node >/dev/null 2>&1 || stop_here "Node.js was not found."
command -v npm >/dev/null 2>&1 || stop_here "npm was not found."
[ -f "$ROOT/.env" ] || stop_here ".env is missing."
command -v git >/dev/null 2>&1 && git rev-parse --short HEAD >/dev/null 2>&1 && echo "Code version: $(git rev-parse --short HEAD) $(git log -1 --format=%s 2>/dev/null)"

echo
echo "1/7 · Tests"
if ! node --test --test-reporter=tap tests/*.test.mjs > "$STATE/update-tests.log" 2>&1; then
  grep -E "^not ok|# (pass|fail)" "$STATE/update-tests.log" | tail -n 20
  stop_here "tests failed. Nothing was changed (details: .yogurt/update-tests.log)."
fi
grep -E "^# (pass|fail)" "$STATE/update-tests.log"

echo
echo "2/7 · Database backup"
scripts/backup-and-verify.sh > "$STATE/update-backup.log" 2>&1 || { tail -n 20 "$STATE/update-backup.log"; stop_here "the database backup or restore verification failed. Nothing was changed."; }
BACKUP_FILE="$(tail -n 1 "$STATE/update-backup.log")"
[ -f "$BACKUP_FILE" ] || stop_here "the database backup did not produce a file. Nothing was changed."
echo "Backup: $BACKUP_FILE"

echo
echo "3/7 · Stop the web server"
date +%s > "$STATE/maintenance"   # the health monitor does not alert during the update
scripts/server-control.sh stop || stop_here "the web server could not be stopped. Nothing was changed."
rm -rf "$ROLLBACK"; mkdir -p "$ROLLBACK"
[ -d .next ] && mv .next "$ROLLBACK/next"

echo
echo "4/7 · Dependencies"
LOCK_HASH="$(shasum -a 256 package-lock.json | cut -d' ' -f1)"
if [ ! -d node_modules ] || [ "$LOCK_HASH" != "$(cat "$STATE/deployed-lock.sha256" 2>/dev/null)" ]; then
  echo "package-lock.json changed: installing the exact versions (npm ci)..."
  NPM_RAN=1
  [ -d node_modules ] && mv node_modules "$ROLLBACK/node_modules"
  npm ci --no-audit --no-fund || give_up "npm ci failed (no internet?)."
else
  echo "Unchanged."
  [ -d node_modules/.prisma ] && cp -R node_modules/.prisma "$ROLLBACK/prisma-client"
fi

echo
echo "5/7 · Build"
# Reuse the build cache (it is not needed to run the previous version) so the site is back sooner.
if [ -d "$ROLLBACK/next/cache" ]; then mkdir -p .next && mv "$ROLLBACK/next/cache" .next/cache; fi
$PRISMA generate || give_up "prisma generate failed."
node node_modules/next/dist/bin/next build || give_up "the build failed. The previous version is unchanged."

echo
echo "6/7 · Database migration"
$PRISMA migrate deploy || give_up "the database migration failed. The backup from step 2 is $BACKUP_FILE."

echo
echo "7/7 · Start and check"
if ! scripts/server-control.sh start || ! check_site; then
  scripts/server-control.sh stop >/dev/null 2>&1 || true
  give_up "the new version did not pass the checks. The database migration stays; the backup from step 2 is $BACKUP_FILE."
fi

echo "$LOCK_HASH" > "$STATE/deployed-lock.sha256"
command -v git >/dev/null 2>&1 && git rev-parse HEAD > "$STATE/deployed-commit" 2>/dev/null
rm -rf "$ROLLBACK" "$STATE/maintenance"
echo
echo "=== UPDATE APPLIED ==="
echo "Web: http://127.0.0.1:$PORT"
echo "Backup taken before the update: $BACKUP_FILE"
echo "Log: .yogurt/update.log"
pause
