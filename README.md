# Yogurt Super Web (YoguManage)

Operations system for a yogurt consignment business: production, raw materials, store fridges,
refills, driver audits and payments, expenses, reports and alerts. The interface is in Lao.

Next.js 15 (App Router) · React 19 · TypeScript · Prisma 6 · PostgreSQL 16.

## How production runs on this Mac

- PostgreSQL 16 (Homebrew service) holds the database `yogurt_ops`.
- A launchd job runs `.yogurt/start-server-public.sh` (`next start` on `127.0.0.1:3000`).
- A Cloudflare tunnel publishes port 3000 at the public URL.
- launchd jobs `com.yogurt.manager.health` (every 5 minutes), `com.yogurt.manager.backup` (03:15 daily)
  and `com.yogurt.manager.backup-verify` (Sunday 03:45) run the scripts in `scripts/`.

## Everyday tasks (double-click)

| File | What it does |
| --- | --- |
| `Apply Yogurt Update.command` | Tests → database backup → stop → `npm ci` if `package-lock.json` changed → build → `prisma migrate deploy` → start → health check. Puts the previous version back if any step after the stop fails. The site is offline for 1–3 minutes. |
| `Start Yogurt Web.command` / `Stop Yogurt Web.command` / `Yogurt Web Status.command` | Control the production server through its launchd job (`scripts/server-control.sh`). |
| `Change Password.command` | Set a new password (15+ characters) for an account; signs out its earlier sessions and lifts a lockout. |
| `Setup Yogurt Database.command` | One-time setup of PostgreSQL, `.env`, migrations and the first build on a new Mac. |
| `Start Yogurt App.command` | Development server on `http://127.0.0.1:3005` (never on 3000, which the tunnel publishes). |

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
```

Schema changes go through migrations (`npx prisma migrate dev --name <change>` on a development
database); production applies them with `prisma migrate deploy` during an update. Never run
`prisma db push` against the production database.

More detail: `DATABASE_SETUP.md` (setup, data rules, backups, alerts), `PRODUCT.md`, `DESIGN.md`.

## Business rules in short

- `unitsSold = previousStock − countRemaining − countExpiredReturned` (refills are already in `previousStock`).
- `gross = unitsSold × retailPrice`, `storeCommission = gross × commissionRate`, `netPayable = gross − storeCommission`, all in exact cents.
- A store's stock is the stock of the fridge that stands in it now. Returned expired cups and central
  write-offs keep their lot or batch cost, and reports subtract that cost from profit.
