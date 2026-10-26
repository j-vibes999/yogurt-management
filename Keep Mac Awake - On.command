#!/bin/bash
# Turns on the setting that keeps this Mac awake while plugged in (see scripts/keep-awake.sh).
cd "$(dirname "$0")" || exit 1
mkdir -p .yogurt
scripts/keep-awake.sh on 2>&1 | tee .yogurt/keep-awake.log
read -r -p "Press Return to close..." _
