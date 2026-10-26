#!/bin/zsh
# Development server on http://127.0.0.1:3005. Never 3000: the Cloudflare tunnel publishes port 3000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT/.yogurt-next.pid"
LOG_FILE="$ROOT/.yogurt-next.log"
PORT=3005
cd "$ROOT"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$PID" ] && /bin/kill -0 "$PID" 2>/dev/null; then
    echo "Yogurt app is already running (PID $PID)."
    echo "http://127.0.0.1:$PORT"
    exit 0
  fi
  /bin/rm -f "$PID_FILE"
fi

NODE="/usr/local/bin/node"
if [ ! -x "$NODE" ]; then NODE="$(command -v node || true)"; fi
NEXT="$ROOT/node_modules/next/dist/bin/next"
if [ -z "$NODE" ] || [ ! -x "$NODE" ] || [ ! -f "$NEXT" ]; then
  echo "Node.js or Next.js is missing."
  exit 1
fi

/usr/bin/nohup "$NODE" "$NEXT" dev --hostname 127.0.0.1 --port "$PORT" >> "$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

READY=0
for i in {1..30}; do
  if /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:$PORT" >/dev/null 2>&1; then READY=1; break; fi
  if ! /bin/kill -0 "$PID" 2>/dev/null; then break; fi
  /bin/sleep 1
done

if [ "$READY" -eq 1 ]; then
  echo "Yogurt app is ready in the background."
  echo "http://127.0.0.1:$PORT"
  exit 0
fi

echo "Yogurt app did not become ready. Recent log:"
/usr/bin/tail -n 50 "$LOG_FILE" 2>/dev/null || true
exit 1
