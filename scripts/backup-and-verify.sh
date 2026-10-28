#!/bin/sh
# Daily job: a successful backup includes a restore/invariant check on local PostgreSQL.
# Stdout contains only the verified dump path, preserving backup-db.sh callers' contract.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP=$("$ROOT/scripts/backup-db.sh")
"$ROOT/scripts/verify-backup-restore.sh" "$BACKUP" >&2
printf '%s\n' "$BACKUP"
