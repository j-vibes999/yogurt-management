#!/bin/bash
# Moves the website to the Supabase database and starts it fresh with only the set-up data
# (scripts/move-to-supabase.sh). A full backup of the old data is taken first.
cd "$(dirname "$0")" || exit 1
mkdir -p .yogurt
scripts/move-to-supabase.sh 2>&1 | tee .yogurt/supabase-move.log
read -r -p "Press Return to close..." _
