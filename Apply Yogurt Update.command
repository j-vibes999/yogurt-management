#!/bin/zsh
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
STATE="$ROOT/.yogurt"
PIDFILE="$STATE/web.pid"
LOG="$STATE/update.log"
NODE=/usr/local/bin/node
NEXT="$ROOT/node_modules/next/dist/bin/next"
BACKUP="$ROOT/.next.previous"

mkdir -p "$STATE"
cd "$ROOT" || exit 1
exec > >(tee -a "$LOG") 2>&1

echo "=== Apply Yogurt UX 4.0 Update ==="
echo "Started: $(date)"

echo
echo "1/5 · Regression tests"
"$NODE" --test "$ROOT/tests/business.test.mjs" "$ROOT/tests/source-invariants.test.mjs"
if [ $? -ne 0 ]; then
  echo "Tests failed. Current running version was not changed."
  read "_?Press Return to close..."
  exit 1
fi

echo
echo "2/5 · Stop current Yogurt Web"
OLDPID=""
if [ -f "$PIDFILE" ]; then
  OLDPID=$(/bin/cat "$PIDFILE" 2>/dev/null || true)
fi
if [ -n "$OLDPID" ] && /bin/kill -0 "$OLDPID" 2>/dev/null; then
  /bin/kill "$OLDPID"
  for i in {1..15}; do
    /bin/kill -0 "$OLDPID" 2>/dev/null || break
    /bin/sleep 1
  done
fi
/bin/rm -f "$PIDFILE"

echo
echo "3/5 · Backup current build and build update"
/bin/rm -rf "$BACKUP"
if [ -d "$ROOT/.next" ]; then
  /bin/mv "$ROOT/.next" "$BACKUP"
fi

"$NODE" "$NEXT" build
BUILD_STATUS=$?
if [ $BUILD_STATUS -ne 0 ]; then
  echo
  echo "Build failed — restoring previous production build."
  /bin/rm -rf "$ROOT/.next"
  if [ -d "$BACKUP" ]; then
    /bin/mv "$BACKUP" "$ROOT/.next"
    /bin/zsh "$ROOT/Start Yogurt Web.command" --no-pause || true
  fi
  echo "Previous version restored. See $LOG"
  read "_?Press Return to close..."
  exit $BUILD_STATUS
fi

/bin/rm -rf "$BACKUP"

echo
echo "4/5 · Start updated Yogurt Web"
/bin/zsh "$ROOT/Start Yogurt Web.command" --no-pause
if [ $? -ne 0 ]; then
  echo "Updated build exists but server start failed. See $STATE/web.log"
  read "_?Press Return to close..."
  exit 1
fi

echo
echo "5/5 · Verify core routes"
CORE_OK=1
for ROUTE in / /map /stores /refills /driver /inventory /production /settlements /expenses /reports /fridges /notifications; do
  if /usr/bin/curl -fsS --max-time 5 "http://127.0.0.1:3000${ROUTE}" >/dev/null 2>&1; then
    echo "${ROUTE}: HEALTHY"
  else
    echo "${ROUTE}: FAILED"
    CORE_OK=0
  fi
done
if [ "$CORE_OK" -eq 1 ]; then
  echo "Core routes: HEALTHY"
else
  echo "One or more core routes did not pass the HTTP health check."
  /usr/bin/tail -n 50 "$STATE/web.log" 2>/dev/null || true
  read "_?Press Return to close..."
  exit 1
fi

echo
echo "=== UPDATE APPLIED ==="
echo "Web: http://127.0.0.1:3000"
echo "Map: http://127.0.0.1:3000/map"
echo "Update: UX 4.0 modern operations UI + split-view OpenStreetMap + readable Lao typography + modern dialogs/forms"
echo "Log: $LOG"
read "_?Press Return to close..."
