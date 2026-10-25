#!/bin/sh
set -eu
ROOT="/Users/justkay/Projects/Yogurt_Super_Web"
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH
mkdir -p "$ROOT/.yogurt/health"
NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
LOCAL=$(curl -fsS --max-time 5 http://127.0.0.1:3000/api/health || printf '{"status":"down"}')
PUBLIC=$(curl -fsS --max-time 8 https://yogurt.bruhgodmod.online/api/health || printf '{"status":"down"}')
printf '{"checkedAt":"%s","local":%s,"public":%s}\n' "$NOW" "$LOCAL" "$PUBLIC" > "$ROOT/.yogurt/health/last.json"
printf '%s local=%s public=%s\n' "$NOW" "$(printf '%s' "$LOCAL" | tr -d '\n')" "$(printf '%s' "$PUBLIC" | tr -d '\n')" >> "$ROOT/.yogurt/health/history.log"
tail -n 500 "$ROOT/.yogurt/health/history.log" > "$ROOT/.yogurt/health/history.log.tmp" && mv "$ROOT/.yogurt/health/history.log.tmp" "$ROOT/.yogurt/health/history.log"

LOCAL_STATUS=$(printf '%s' "$LOCAL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).status||"down"))}catch{process.stdout.write("down")}})')
PUBLIC_STATUS=$(printf '%s' "$PUBLIC" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).status||"down"))}catch{process.stdout.write("down")}})')
if [ "$LOCAL_STATUS" != "ok" ] || [ "$PUBLIC_STATUS" != "ok" ]; then
  MESSAGE="health check failed: local=$LOCAL_STATUS public=$PUBLIC_STATUS"
  printf '%s\n' "$MESSAGE" >&2
  "$ROOT/scripts/send-alert.sh" error health.degraded "$MESSAGE" >/dev/null 2>&1 || true
  exit 1
fi
