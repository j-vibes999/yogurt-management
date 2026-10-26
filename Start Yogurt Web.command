#!/bin/bash
# Start the production web server (through its launchd job when it exists).
cd "$(dirname "$0")" || exit 1
scripts/server-control.sh start
echo
read -r -p "Press Return to close..." _
