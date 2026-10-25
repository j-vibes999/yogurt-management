#!/bin/zsh
set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$ROOT/.yogurt/web.pid"

if [ ! -f "$PIDFILE" ]; then
  echo "No Yogurt Web PID file found."
  read "_?Press Return to close..."
  exit 0
fi

PID=$(/bin/cat "$PIDFILE" 2>/dev/null || true)
if [ -n "$PID" ] && /bin/kill -0 "$PID" 2>/dev/null; then
  /bin/kill "$PID"
  for i in {1..10}; do
    /bin/kill -0 "$PID" 2>/dev/null || break
    /bin/sleep 1
  done
  echo "Stopped Yogurt Web PID $PID"
else
  echo "Yogurt Web process was already stopped."
fi
/bin/rm -f "$PIDFILE"
read "_?Press Return to close..."
