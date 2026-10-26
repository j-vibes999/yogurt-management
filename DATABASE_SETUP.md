# Yogurt Super Web — Final Local Setup & Operations

The application is now **Prisma/PostgreSQL-first**. Demo data is used only as a read-only fallback when `DATABASE_URL` is missing or PostgreSQL cannot be reached.

## One-time setup

Double-click:

`Setup Yogurt Database.command`

The helper performs the full local setup in this order:

1. Detect Homebrew.
2. Install PostgreSQL 16 if it is not already installed.
3. Start PostgreSQL as a background Homebrew service.
4. Create the `yogurt_ops` database.
5. Write a local `.env` with `DATABASE_URL` for the current macOS user.
6. Run `prisma validate`.
7. Regenerate Prisma Client.
8. Deploy pending migrations.
9. Seed the business data only when the database is empty. Set the initial admin password only if it has not been set before.
10. Run regression tests.
11. Build the Next.js production app.
12. Verify database row counts.
13. Start Yogurt Web in the background on `http://127.0.0.1:3000`.

The helper stops immediately if validation, tests, migration deployment or production build fails. The log is stored in `.yogurt/setup.log`.

`npm run db:setup` may be rerun safely: it skips demo seeding when operational records exist and keeps an existing admin password. Initial setup requires an `ADMIN_PASSWORD` of at least 15 characters in `.env`; later intentional resets use `npm run auth:set-admin`.

Every login creates a row in `user_sessions`; logging out deletes it, so a copied cookie stops working. Resetting a password (user API, `Change Password.command` or `npm run auth:set-admin`) deletes that user's session rows and lifts a login lockout. After 5 wrong passwords in a row an account is locked for 15 minutes, doubling up to 1 hour. To revoke every user's session after a suspected compromise, replace `SESSION_SECRET` with a new random value of at least 32 characters and restart every running app instance. The authenticated smoke and business workflow tests read `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`; keep those values private.

## Day-to-day helpers

- `Apply Yogurt Update.command` — tests → database backup → stop → `npm ci` when `package-lock.json` changed → `prisma generate` → build → `prisma migrate deploy` → start → health check. If a step after the stop fails, the previous build is started again.
- `Start Yogurt Web.command`, `Stop Yogurt Web.command`, `Yogurt Web Status.command` — control the production server through its launchd job `com.yogurt.manager.server` (`scripts/server-control.sh`).
- `Change Password.command` — sets a new password (15+ characters) for an account, signs out its earlier sessions and lifts a lockout.

## Background jobs (launchd, `~/Library/LaunchAgents`)

| Job | Runs | What it does |
| --- | --- | --- |
| `com.yogurt.manager.server` | always | `.yogurt/start-server-public.sh`: `next start` on `127.0.0.1:3000`; keeps the Mac awake while plugged in |
| `com.yogurt.manager.tunnel` | always | Cloudflare tunnel that publishes port 3000 |
| `com.yogurt.manager.health` | every 5 minutes | `scripts/health-check.sh`: checks local and public `/api/health`, retries once, alerts after `HEALTH_ALERT_AFTER` failures in a row (default 2) and reports sleep gaps |
| `com.yogurt.manager.backup` | 03:15 daily | `scripts/backup-db.sh` |
| `com.yogurt.manager.backup-verify` | Sunday 03:45 | `scripts/verify-backup-restore.sh` |

The jobs use absolute paths under `/Users/justkay/Projects/Yogurt_Super_Web`. Keep the project in that folder; if it moves, the site, the health check and the backups stop.

## Backups

`scripts/backup-db.sh` writes `.yogurt/backups/yogurt_ops-<time>.dump` with a `.sha256`, archives the payment-slip images (`.yogurt/private-receipts`) next to it as `.receipts.tar.gz`, and keeps 14 days. Set `BACKUP_OFFSITE_DIR` in `.env` (for example an iCloud Drive folder) to copy every backup off this Mac, encrypted with `BACKUP_PASSPHRASE` when it is set; off-site copies are kept 30 days. Without an off-site copy, losing this Mac loses the backups too.

`scripts/verify-backup-restore.sh` restores the newest dump into a scratch database, checks counts and invariants and the slip archive checksum, then drops the scratch database. `npm run db:dr-drill` also starts the app on the restored copy (port 3121) and runs the business E2E test against it.

## Alerts

`scripts/send-alert.sh` always shows a macOS notification and appends to `.yogurt/alerts/events.ndjson`. To get alerts on your phone, create a Telegram bot with @BotFather and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env` (or set `ALERT_WEBHOOK_URL`). The same alert is sent at most once every 15 minutes. Test with `npm run alerts:test`.

## Data integrity rules

- Store removal is a **soft deactivation**. It is blocked while a store has active refill work, an outstanding receivable or cups left in its fridge.
- A fridge cannot leave a store that still owes money, and a fridge with stock cannot move. A store's stock and audit lines are those of the fridge that stands in it now.
- Expense removal is an auditable **void**, not a hard delete.
- Manual raw-material stock changes create `RawMaterialAdjustment` audit records and cannot drive stock below zero.
- Refill lifecycle is `waiting → preparing → delivering → completed` (or cancelled). Completion deducts finished goods using FEFO and refuses completion when central stock is insufficient.
- Weekly restock/settlement rejects stale inventory/refill snapshots, prevents negative sales reconciliation and prevents overpayment.
- Payment and restock POST requests require a UUID `Idempotency-Key` header. The browser saves unresolved requests and retries them with the same key after a reload.
- Production validates raw materials and deducts them transactionally before a finished-goods batch is created.

## Cost / profit reporting

New production batches record `totalMaterialCost` and `unitCost` from the weighted-average raw-material costs at production time. Weekly audits record product COGS per sold SKU. Reports use recorded COGS when the relevant data has complete cost lineage.

Historical/demo rows that do not yet have recorded cost lineage are explicitly shown in **estimated** mode and use the previous 28% sales-cost fallback for those missing rows. Once real material receipts, production and weekly audits are recorded, the report switches to actual recorded COGS.

Expired or damaged cups returned from fridges keep the cost of their lot (`expired_cost`), and central write-offs keep their batch cost (`finished_goods_adjustments.unit_cost`). Reports subtract both from gross and net profit as "waste cost".

## Demo fallback

If PostgreSQL becomes unavailable, users with a valid signed session can open the read-only overview pages using `src/data/demo.ts` through `src/lib/db-data.ts`. Detail and editing pages return to the overview. Mutating buttons are disabled in fallback mode. A new login requires PostgreSQL. Password resets and account deactivation cannot be checked while PostgreSQL is down, so an earlier signed session may continue to see static demo data until it expires; it cannot read live operational data or make changes.

## Important local files

- `.env` — local database connection; ignored by git.
- `.yogurt/setup.log` — one-click setup log.
- `.yogurt/launch-server.log`, `.yogurt/launch-server.err.log` — production server log (launchd job).
- `.yogurt/health/` — health history; `.yogurt/alerts/` — alert log; `.yogurt/backups/` — backups.
- `.yogurt/start-server-public.sh` — the server start script the launchd job runs.

Do not commit `.env` or local runtime logs.
