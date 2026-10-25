#!/bin/zsh
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
STATE="$ROOT/.yogurt"
PIDFILE="$STATE/web.pid"
LOG="$STATE/web.log"
NODE=/usr/local/bin/node
NEXT="$ROOT/node_modules/next/dist/bin/next"
mkdir -p "$STATE"
cd "$ROOT" || exit 1

if /usr/bin/curl -fsS --max-time 2 http://127.0.0.1:3000/ >/dev/null 2>&1; then
  echo "Yogurt Web is already healthy at http://127.0.0.1:3000"
  [ "${1:-}" = "--no-pause" ] || read "_?Press Return to close..."
  exit 0
fi

if [ -f "$PIDFILE" ]; then
  OLD=$(/bin/cat "$PIDFILE" 2>/dev/null || true)
  if [ -n "$OLD" ] && /bin/kill -0 "$OLD" 2>/dev/null; then
    echo "A Yogurt Web process is already running with PID $OLD but is not healthy yet."
    /usr/bin/tail -n 30 "$LOG" 2>/dev/null || true
    [ "${1:-}" = "--no-pause" ] || read "_?Press Return to close..."
    exit 1
  fi
fi

if [ ! -f "$ROOT/.next/BUILD_ID" ]; then
  echo "Production build not found. Run Setup Yogurt Database.command first."
  [ "${1:-}" = "--no-pause" ] || read "_?Press Return to close..."
  exit 1
fi

/usr/bin/nohup "$NODE" "$NEXT" start -H 127.0.0.1 -p 3000 >> "$LOG" 2>&1 &
PID=$!
echo "$PID" > "$PIDFILE"

HEALTHY=0
for i in {1..20}; do
  if /usr/bin/curl -fsS --max-time 2 http://127.0.0.1:3000/ >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  /bin/sleep 1
done

if [ "$HEALTHY" -eq 1 ]; then
  echo "Yogurt Web started in background: http://127.0.0.1:3000 (PID $PID)"
else
  echo "Yogurt Web did not become healthy. Recent log:"
  /usr/bin/tail -n 50 "$LOG" 2>/dev/null || true
  [ "${1:-}" = "--no-pause" ] || read "_?Press Return to close..."
  exit 1
fi

[ "${1:-}" = "--no-pause" ] || read "_?Press Return to close..."
