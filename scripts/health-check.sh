#!/bin/sh
# Runs every 5 minutes (launchd com.yogurt.manager.health): checks the local server and the public
# URL, keeps a history, and alerts after HEALTH_ALERT_AFTER failed checks in a row (default 2).
# A failed check is retried once after 10 seconds, so a single dropped request does not count.
# A long gap since the previous check means this Mac was asleep or off; that is reported once.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export PATH
. "$ROOT/scripts/lib-env.sh"
DIR="$ROOT/.yogurt/health"
mkdir -p "$DIR"
PUBLIC_URL=$(env_value PUBLIC_BASE_URL)
PUBLIC_URL=${PUBLIC_URL:-https://yogurt.bruhgodmod.online}
ALERT_AFTER=$(env_value HEALTH_ALERT_AFTER)
ALERT_AFTER=${ALERT_AFTER:-2}

NOW_EPOCH=$(date +%s)
LAST_EPOCH=$(cat "$DIR/last-check-epoch" 2>/dev/null || echo 0)
printf '%s' "$NOW_EPOCH" > "$DIR/last-check-epoch"
if [ "$LAST_EPOCH" -gt 0 ] 2>/dev/null && [ $((NOW_EPOCH - LAST_EPOCH)) -gt 900 ]; then
  "$ROOT/scripts/send-alert.sh" warning health.gap "No health check for $(((NOW_EPOCH - LAST_EPOCH) / 60)) minutes; check this Mac and its network connection." >/dev/null 2>&1 || true
fi

status_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).status||"down"))}catch{process.stdout.write("down")}})'; }
check() {
  LOCAL=$(curl -fsS --max-time 5 http://127.0.0.1:3000/api/health || printf '{"status":"down"}')
  PUBLIC=$(curl -fsS --max-time 8 "$PUBLIC_URL/api/health" || printf '{"status":"down"}')
  LOCAL_STATUS=$(printf '%s' "$LOCAL" | status_of)
  PUBLIC_STATUS=$(printf '%s' "$PUBLIC" | status_of)
}
check
if [ "$LOCAL_STATUS" != "ok" ] || [ "$PUBLIC_STATUS" != "ok" ]; then sleep 10; check; fi

NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
printf '{"checkedAt":"%s","local":%s,"public":%s}\n' "$NOW" "$LOCAL" "$PUBLIC" > "$DIR/last.json"
printf '%s local=%s public=%s\n' "$NOW" "$(printf '%s' "$LOCAL" | tr -d '\n')" "$(printf '%s' "$PUBLIC" | tr -d '\n')" >> "$DIR/history.log"
tail -n 2000 "$DIR/history.log" > "$DIR/history.log.tmp" && mv "$DIR/history.log.tmp" "$DIR/history.log"

if [ "$LOCAL_STATUS" = "ok" ] && [ "$PUBLIC_STATUS" = "ok" ]; then
  printf '0' > "$DIR/consecutive-failures"
  exit 0
fi
FAILURES=$(( $(cat "$DIR/consecutive-failures" 2>/dev/null || echo 0) + 1 ))
printf '%s' "$FAILURES" > "$DIR/consecutive-failures"
MESSAGE="health check failed: local=$LOCAL_STATUS public=$PUBLIC_STATUS"
printf '%s\n' "$MESSAGE" >&2
# No alerts while an update is running (Apply Yogurt Update.command writes .yogurt/maintenance).
if [ -f "$ROOT/.yogurt/maintenance" ] && [ $((NOW_EPOCH - $(cat "$ROOT/.yogurt/maintenance" 2>/dev/null || echo 0))) -lt 1800 ]; then exit 1; fi
if [ "$FAILURES" -ge "$ALERT_AFTER" ]; then
  "$ROOT/scripts/send-alert.sh" error health.degraded "$MESSAGE ($FAILURES checks in a row)" >/dev/null 2>&1 || true
fi
exit 1
