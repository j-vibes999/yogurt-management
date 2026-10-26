#!/bin/bash
# Keeps this Mac from going to sleep while it is plugged in, so the website stays online.
# The display still turns off as usual, on battery the Mac sleeps as usual,
# and closing the lid of a MacBook still puts it to sleep.
#   scripts/keep-awake.sh on | off | status
set -u
LABEL="com.yogurt.manager.awake"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

case "${1:-status}" in
  on)
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/usr/bin/caffeinate</string><string>-s</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
EOF
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null && sleep 1
    launchctl bootstrap "$DOMAIN" "$PLIST" || { echo "Could not start the keep-awake job."; exit 1; }
    sleep 1
    ;;
  off)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    ;;
  status) ;;
  *) echo "usage: $0 on|off|status"; exit 2 ;;
esac

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo "Keep awake: ON - the Mac does not go to sleep while it is plugged in."
else
  echo "Keep awake: OFF - the Mac sleeps as set in System Settings."
fi
pmset -g assertions 2>/dev/null | grep -E "caffeinate|PreventSystemSleep" | head -4
