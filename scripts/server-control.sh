#!/bin/bash
# Start, stop, restart or check the production web server.
#
# On this Mac the server normally runs as a launchd job: the plist in ~/Library/LaunchAgents
# that runs .yogurt/start-server-public.sh. This script drives that job with launchctl, so only
# one server ever holds the port. Without such a job it runs `next start` in the background.
#
# Usage: scripts/server-control.sh start|stop|restart|status
# YOGURT_PORT changes the port (default 3000); tests use it.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/.yogurt"
PORT="${YOGURT_PORT:-3000}"
PIDFILE="$STATE/web.pid"
LOG="$STATE/web.log"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$STATE"

PLIST=""
LABEL=""
DOMAIN="gui/$(id -u)"
for file in "$HOME"/Library/LaunchAgents/*.plist; do
  [ -f "$file" ] || continue
  if grep -q "start-server-public.sh" "$file" 2>/dev/null; then PLIST="$file"; break; fi
done
if [ -n "$PLIST" ]; then
  if [ -x /usr/libexec/PlistBuddy ]; then LABEL="$(/usr/libexec/PlistBuddy -c 'Print :Label' "$PLIST" 2>/dev/null || true)"; fi
  [ -n "$LABEL" ] || LABEL="$(tr -d '\n\r\t' < "$PLIST" | sed -n 's:.*<key>Label</key> *<string>\([^<]*\)</string>.*:\1:p')"
  [ -n "$LABEL" ] || PLIST=""
fi

health_json() { curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null; }
healthy() { health_json | grep -q '"db":{"ok":true'; }
answering() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/health"; }
uptime_seconds() { health_json | sed -n 's/.*"uptimeSeconds":\([0-9][0-9]*\).*/\1/p'; }
job_loaded() { [ -n "$LABEL" ] && launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }
# Right after a bootout, launchd may still be tearing the job down; try again for a few seconds.
bootstrap_job() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null && return 0
    job_loaded && return 0
    sleep 1
  done
  launchctl bootstrap "$DOMAIN" "$PLIST"
}

# Healthy, and (when a start time is given) started after it, so an old process does not count.
wait_healthy() {
  local seconds="$1" since="${2:-}" i=0 up
  while [ "$i" -lt "$seconds" ]; do
    if healthy; then
      [ -z "$since" ] && return 0
      up="$(uptime_seconds)"
      if [ -n "$up" ] && [ "$up" -le $(( $(date +%s) - since + 2 )) ]; then return 0; fi
    fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

# A `next start` from this folder that still holds the port (left over from a manual start).
leftover_pids() {
  local pid
  for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null); do
    ps -o command= -p "$pid" 2>/dev/null | grep -q "next" && echo "$pid"
  done
}

start() {
  if healthy; then echo "The web server is already running: http://127.0.0.1:$PORT"; return 0; fi
  [ -f "$ROOT/.next/BUILD_ID" ] || { echo "There is no production build (.next). Run 'Apply Yogurt Update.command' first."; return 1; }
  local since; since="$(date +%s)"
  if [ -n "$PLIST" ]; then
    if job_loaded; then launchctl kickstart -k "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
    else bootstrap_job || { echo "launchd could not load $LABEL."; return 1; }
    fi
  else
    (cd "$ROOT" && nohup node node_modules/next/dist/bin/next start -H 127.0.0.1 -p "$PORT" >> "$LOG" 2>&1 & echo $! > "$PIDFILE")
  fi
  if wait_healthy 90 "$since"; then echo "The web server is running: http://127.0.0.1:$PORT"; return 0; fi
  echo "The web server did not become healthy. Recent log:"
  tail -n 30 "$STATE/launch-server.err.log" "$LOG" 2>/dev/null
  return 1
}

stop() {
  if [ -n "$PLIST" ] && job_loaded; then
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || launchctl bootout "$DOMAIN" "$PLIST" 2>/dev/null || true
  fi
  if [ -f "$PIDFILE" ]; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; rm -f "$PIDFILE"; fi
  local i pids
  for i in $(seq 1 20); do answering || { echo "The web server is stopped."; return 0; }; sleep 1; done
  pids="$(leftover_pids)"
  if [ -n "$pids" ]; then kill $pids 2>/dev/null || true; sleep 3; fi
  if answering; then echo "Port $PORT is still in use by another program."; return 1; fi
  echo "The web server is stopped."
}

status() {
  echo "=== Yogurt Web Status ==="
  if [ -n "$PLIST" ]; then
    if job_loaded; then echo "launchd job: $LABEL (loaded)"; else echo "launchd job: $LABEL (not loaded)"; fi
  else
    echo "launchd job: none (started by hand)"
  fi
  if healthy; then echo "Web: HEALTHY — http://127.0.0.1:$PORT"
  elif answering; then echo "Web: answering, but the database is not OK"
  else echo "Web: NOT RUNNING"
  fi
  health_json && echo
  if command -v pg_isready >/dev/null 2>&1 && pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then echo "PostgreSQL: READY"; else echo "PostgreSQL: NOT READY"; fi
  echo
  echo "=== Recent server log ==="
  tail -n 15 "$STATE/launch-server.log" 2>/dev/null
  tail -n 10 "$STATE/launch-server.err.log" 2>/dev/null
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop && start ;;
  status) status ;;
  *) echo "Usage: scripts/server-control.sh start|stop|restart|status"; exit 2 ;;
esac
