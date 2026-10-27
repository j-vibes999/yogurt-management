#!/bin/bash
# Copies the database from this Mac to Supabase and checks every table (scripts/copy-db-to-supabase.sh).
# The website keeps using the database on this Mac.
cd "$(dirname "$0")" || exit 1
mkdir -p .yogurt
scripts/copy-db-to-supabase.sh 2>&1 | tee .yogurt/supabase-copy.log
read -r -p "Press Return to close..." _
