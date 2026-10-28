# Yogurt Super Web (YoguManage)

Operations system for a yogurt consignment business: production, raw materials, store fridges,
refills, driver audits and payments, expenses, reports and alerts. The interface is in Lao.

Next.js 15 (App Router) · React 19 · TypeScript · Prisma 6 · PostgreSQL 16.

## How production runs on this Mac

- Supabase PostgreSQL holds the active application database (`DATABASE_URL`).
- PostgreSQL 16 (Homebrew service) retains the pre-move `yogurt_ops` database (`LOCAL_DATABASE_URL`) and hosts disposable restore/E2E databases. Production does not write to that old copy.
- A launchd job runs `.yogurt/start-server-public.sh` (`next start` on `127.0.0.1:3000`).
- A Cloudflare tunnel publishes port 3000 at the public URL.
- launchd jobs `com.yogurt.manager.health` (every 5 minutes), `com.yogurt.manager.backup` (03:15 daily)
  and `com.yogurt.manager.backup-verify` (Sunday 03:45) run the scripts in `scripts/`. The daily backup job uses `backup-and-verify.sh` so every new daily dump is restored and checked locally.

## Everyday tasks (double-click)

| File | What it does |
| --- | --- |
| `Apply Yogurt Update.command` | Tests → database backup → stop → `npm ci` if `package-lock.json` changed → build → `prisma migrate deploy` → start → health check. Puts the previous version back if any step after the stop fails. The site is offline for 1–3 minutes. |
| `Start Yogurt Web.command` / `Stop Yogurt Web.command` / `Yogurt Web Status.command` | Control the production server through its launchd job (`scripts/server-control.sh`). |
| `Change Password.command` | Set a new password (15+ characters) for an account; signs out its earlier sessions and lifts a lockout. |
| `Setup Yogurt Database.command` | One-time setup of PostgreSQL, `.env`, migrations and the first build on a new Mac. |
| `Start Yogurt App.command` | Development server on `http://127.0.0.1:3005` (never on 3000, which the tunnel publishes). |
| `Copy Database to Supabase.command` | Copies the database to a Supabase project (asks for the Session pooler link and password, saves the link in `.yogurt/supabase.env`), then checks the row count of every table on both sides. The site keeps using the database on this Mac. Running it again replaces the Supabase copy. |
| `Move to Supabase.command` | Backs up the database on this Mac, copies it to Supabase, keeps only users, products and prices, recipes, raw materials with their cost (stock 0) and expense categories, points `.env` at Supabase (the old link stays as `LOCAL_DATABASE_URL`) and restarts. Goes back to the Mac database if the site does not come up. After the move, backups dump Supabase with Homebrew `libpq` tools and restore checks run on this Mac's PostgreSQL. |
| `Keep Mac Awake - On.command` / `- Off.command` | Keep the Mac from sleeping while it is plugged in (a `caffeinate -s` launchd job, `scripts/keep-awake.sh`), so the site stays online. The display still turns off; on battery or with the lid closed the Mac still sleeps. |

## Configuration (`.env`)

See `.env.example`. Required: `DATABASE_URL`, `SESSION_SECRET` (32+ random characters).
Optional: `ADMIN_EMAIL`/`ADMIN_PASSWORD` (first setup only), `HEALTH_TOKEN`, `PUBLIC_BASE_URL`,
`HEALTH_ALERT_AFTER`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, `ALERT_WEBHOOK_URL`,
`BACKUP_OFFSITE_DIR`, `BACKUP_PASSPHRASE`.

## Development

```sh
npm ci
npm run dev -- -p 3005        # or Start Yogurt App.command
npm run verify                # prisma validate, eslint, tsc, unit tests, next build
npm run test:e2e:business     # copies the database, then runs the business and regression E2E tests on it
npm run test:e2e:offline      # signed read-only fallback with an intentionally unreachable test DB
npm run db:backup             # application-only dump + local restore/invariant verification
npm run db:dr-drill           # restore original rows, then run app/E2E with clone-only fixtures
```

Schema changes go through migrations (`npx prisma migrate dev --name <change>` on a development
database); production applies them with `prisma migrate deploy` during an update. Never run
`prisma db push` against the production database.

More detail: `DATABASE_SETUP.md` (setup, data rules, backups, alerts), `PRODUCT.md`, `DESIGN.md`.

The current [operations runbook](docs/OPERATIONS.md) covers Supabase API-role isolation, portable backups, recovery evidence, offsite archives, alerts, and the distinction between availability and readiness.

## Business rules in short

- `unitsSold = previousStock − countRemaining − countExpiredReturned` (refills are already in `previousStock`).
- `gross = unitsSold × retailPrice`, `storeCommission = gross × commissionRate`, `netPayable = gross − storeCommission`, all in exact cents.
- A store's stock is the stock of the fridge that stands in it now. Returned expired cups and central
  write-offs keep their lot or batch cost, and reports subtract that cost from profit.
