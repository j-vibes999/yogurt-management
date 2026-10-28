# Source after lib-env.sh. Every write below is restricted to a newly created local scratch DB.
prepare_clone_e2e() {
  DATABASE_URL="$TMP_URL" node "$ROOT/node_modules/prisma/build/index.js" migrate deploy
  DATABASE_URL="$TMP_URL" node "$ROOT/scripts/harden-supabase-api.mjs"
  ADMIN_EMAIL="e2e-$(node -e 'process.stdout.write(crypto.randomUUID())')@example.test"
  ADMIN_PASSWORD=$(node -e 'process.stdout.write(crypto.randomBytes(32).toString("base64url"))')
  E2E_FIXTURE_MODE=${E2E_FIXTURE_MODE:-minimal}
  case "$E2E_FIXTURE_MODE" in minimal|existing) ;; *) echo 'E2E_FIXTURE_MODE must be minimal or existing' >&2; return 2 ;; esac
  E2E_FIXTURE_PRODUCT_ID=''; E2E_FIXTURE_STORE_ID=''
  if [ "$E2E_FIXTURE_MODE" = minimal ]; then
    E2E_FIXTURE_PRODUCT_ID=e2e-readiness-product
    E2E_FIXTURE_STORE_ID=e2e-readiness-store
  fi
  export ADMIN_EMAIL ADMIN_PASSWORD E2E_FIXTURE_MODE E2E_FIXTURE_PRODUCT_ID E2E_FIXTURE_STORE_ID
  DATABASE_URL="$TMP_URL" node "$ROOT/scripts/prepare-e2e-clone.mjs"
}

run_clone_e2e() {
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then echo "Test port $PORT is already in use" >&2; return 2; fi
  E2E_BASE_URL="http://127.0.0.1:$PORT"
  DATABASE_URL="$TMP_URL" INTERNAL_APP_ORIGIN="$E2E_BASE_URL" PORT="$PORT" node "$ROOT/node_modules/next/dist/bin/next" start -H 127.0.0.1 -p "$PORT" >"$LOG" 2>&1 & PID=$!
  _ready=false
  for _ in $(seq 1 60); do
    # Availability is independent of backup readiness: scratch targets intentionally differ.
    if curl -fsS --max-time 3 "$E2E_BASE_URL/api/health" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.exit(JSON.parse(s).db?.ok?0:1)}catch{process.exit(1)}})'; then _ready=true; break; fi
    kill -0 "$PID" 2>/dev/null || { cat "$LOG" >&2; return 1; }
    sleep .5
  done
  [ "$_ready" = true ] || { cat "$LOG" >&2; echo 'Clone server availability timed out' >&2; return 1; }
  DATABASE_URL="$TMP_URL" E2E_BASE_URL="$E2E_BASE_URL" node --env-file=.env "$ROOT/tests/authenticated-smoke.mjs"
  DATABASE_URL="$TMP_URL" E2E_BASE_URL="$E2E_BASE_URL" node --env-file=.env "$ROOT/tests/business-workflow-e2e.mjs"
  if [ -n "${E2E_ADDITIONAL_SCRIPT:-}" ]; then
    DATABASE_URL="$TMP_URL" E2E_BASE_URL="$E2E_BASE_URL" node --env-file=.env "$E2E_ADDITIONAL_SCRIPT"
  fi
}
