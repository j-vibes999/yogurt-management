#!/bin/zsh
ROOT="$(cd "$(dirname "$0")" && pwd)"
echo "=== Yogurt Web Status ==="

if /usr/bin/curl -fsS --max-time 3 http://127.0.0.1:3000/ >/dev/null 2>&1; then
  echo "Web: HEALTHY — http://127.0.0.1:3000"
else
  echo "Web: NOT HEALTHY"
fi

if [ -x /opt/homebrew/opt/postgresql@16/bin/pg_isready ]; then
  PGREADY=/opt/homebrew/opt/postgresql@16/bin/pg_isready
elif [ -x /usr/local/opt/postgresql@16/bin/pg_isready ]; then
  PGREADY=/usr/local/opt/postgresql@16/bin/pg_isready
else
  PGREADY=""
fi

if [ -n "$PGREADY" ] && "$PGREADY" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "PostgreSQL: READY"
else
  echo "PostgreSQL: NOT READY / NOT INSTALLED"
fi

if [ -f "$ROOT/.env" ]; then
  echo "DATABASE_URL: configured"
else
  echo "DATABASE_URL: missing"
fi

echo
echo "=== Recent web log ==="
/usr/bin/tail -n 20 "$ROOT/.yogurt/web.log" 2>/dev/null || true
read "_?Press Return to close..."
