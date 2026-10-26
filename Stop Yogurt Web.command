#!/bin/bash
# Stop the production web server. The public site is offline until it starts again.
cd "$(dirname "$0")" || exit 1
scripts/server-control.sh stop
echo
read -r -p "Press Return to close..." _
