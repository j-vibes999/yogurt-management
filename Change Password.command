#!/bin/bash
# Set a new password (15+ characters) for an account. Its earlier sessions are signed out and a
# login lockout is lifted. Nothing is shown on screen while you type the password.
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
pause() { read -r -p "Press Return to close..." _; }
echo "=== Change a Yogurt Manager password ==="
[ -f .env ] || { echo ".env is missing."; pause; exit 1; }
read -r -p "Account email: " EMAIL
read -r -s -p "New password (at least 15 characters): " PASSWORD; echo
read -r -s -p "Type the new password again: " AGAIN; echo
if [ "$PASSWORD" != "$AGAIN" ]; then echo "The two passwords are different. Nothing was changed."; pause; exit 1; fi
YOGURT_EMAIL="$EMAIL" YOGURT_PASSWORD="$PASSWORD" node --env-file=.env scripts/change-password.mjs
pause
