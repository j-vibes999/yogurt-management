#!/bin/sh
# Send an alert: macOS notification on this Mac, plus Telegram (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)
# and/or a webhook (ALERT_WEBHOOK_URL) when they are set in .env or in the environment.
# The same severity+event is sent at most once per ALERT_COOLDOWN_SECONDS (default 900).
# Usage: scripts/send-alert.sh error|warning|info event.name "message"
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"; export PATH
. "$ROOT/scripts/lib-env.sh"
SEVERITY=${1:-error}; EVENT=${2:-unknown}; MESSAGE=${3:-"No message"}; COOLDOWN=${ALERT_COOLDOWN_SECONDS:-900}
DIR="$ROOT/.yogurt/alerts"; mkdir -p "$DIR"; umask 077
NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ'); EPOCH=$(date '+%s'); KEY=$(printf '%s|%s' "$SEVERITY" "$EVENT" | shasum -a 256 | awk '{print $1}'); STATE="$DIR/$KEY.last"
LAST=0; [ ! -f "$STATE" ] || LAST=$(cat "$STATE" 2>/dev/null || echo 0)
[ $((EPOCH-LAST)) -ge "$COOLDOWN" ] || exit 0
printf '%s' "$EPOCH" > "$STATE"
PAYLOAD=$(node -e 'const [severity,event,message,ts]=process.argv.slice(1);process.stdout.write(JSON.stringify({severity,event,message,ts,service:"yogumanage"}))' "$SEVERITY" "$EVENT" "$MESSAGE" "$NOW")
printf '%s\n' "$PAYLOAD" >> "$DIR/events.ndjson"
SAFE_MESSAGE=$(printf '%s' "$MESSAGE" | tr '\n"\\' '   ' | cut -c1-180)
if command -v osascript >/dev/null 2>&1; then
  osascript -e "display notification \"$SAFE_MESSAGE\" with title \"YoguManage: $EVENT\"" >/dev/null 2>&1 || true
fi
TOKEN=$(env_value TELEGRAM_BOT_TOKEN); CHAT=$(env_value TELEGRAM_CHAT_ID)
if [ -n "$TOKEN" ] && [ -n "$CHAT" ]; then
  curl -fsS --max-time 8 "https://api.telegram.org/bot$TOKEN/sendMessage" --data-urlencode "chat_id=$CHAT" --data-urlencode "text=YoguManage [$SEVERITY] $EVENT: $MESSAGE" >/dev/null 2>&1 || true
fi
WEBHOOK=$(env_value ALERT_WEBHOOK_URL)
if [ -n "$WEBHOOK" ]; then curl -fsS --max-time 8 -H 'Content-Type: application/json' -d "$PAYLOAD" "$WEBHOOK" >/dev/null 2>&1 || true; fi
printf '%s\n' "$PAYLOAD"
