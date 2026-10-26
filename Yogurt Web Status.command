#!/bin/bash
# Show whether the web server and PostgreSQL are running.
cd "$(dirname "$0")" || exit 1
scripts/server-control.sh status
echo
read -r -p "Press Return to close..." _
