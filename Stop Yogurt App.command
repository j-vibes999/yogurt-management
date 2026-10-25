#!/bin/zsh
ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT/.yogurt-next.pid"
if [ ! -f "$PID_FILE" ]; then echo "Yogurt app PID file not found; nothing to stop."; exit 0; fi
PID=$(cat "$PID_FILE" 2>/dev/null || true)
if [ -n "$PID" ] && /bin/kill -0 "$PID" 2>/dev/null; then
  /bin/kill "$PID" || true
  for i in {1..10}; do /bin/kill -0 "$PID" 2>/dev/null || break; /bin/sleep .3; done
fi
/bin/rm -f "$PID_FILE"
echo "Yogurt app stopped."
