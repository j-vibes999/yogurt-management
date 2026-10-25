#!/bin/sh
set -eu
ROOT="/Users/justkay/Projects/Yogurt_Super_Web"; PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"; export PATH
SEVERITY=${1:-error}; EVENT=${2:-unknown}; MESSAGE=${3:-"No message"}; COOLDOWN=${ALERT_COOLDOWN_SECONDS:-900}
DIR="$ROOT/.yogurt/alerts"; mkdir -p "$DIR"; umask 077
NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ'); EPOCH=$(date '+%s'); KEY=$(printf '%s|%s' "$SEVERITY" "$EVENT" | shasum -a 256 | awk '{print $1}'); STATE="$DIR/$KEY.last"
LAST=0; [ ! -f "$STATE" ] || LAST=$(cat "$STATE" 2>/dev/null || echo 0)
[ $((EPOCH-LAST)) -ge "$COOLDOWN" ] || exit 0
printf '%s' "$EPOCH" > "$STATE"
PAYLOAD=$(node -e 'const [severity,event,message,ts]=process.argv.slice(1);process.stdout.write(JSON.stringify({severity,event,message,ts,service:"yogumanage"}))' "$SEVERITY" "$EVENT" "$MESSAGE" "$NOW")
printf '%s\n' "$PAYLOAD" >> "$DIR/events.ndjson"
if command -v osascript >/dev/null 2>&1; then
  SAFE_MESSAGE=$(printf '%s' "$MESSAGE" | tr '\n' ' ' | cut -c1-180)
  osascript -e "display notification \"$SAFE_MESSAGE\" with title \"YoguManage: $EVENT\"" >/dev/null 2>&1 || true
fi
if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then curl -fsS --max-time 8 -H 'Content-Type: application/json' -d "$PAYLOAD" "$ALERT_WEBHOOK_URL" >/dev/null || true; fi
printf '%s\n' "$PAYLOAD"
