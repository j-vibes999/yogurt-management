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

Resetting a password through the user API or `npm run auth:set-admin` automatically invalidates that user's earlier sessions on their next database-backed request. Users must log in with the new password. To revoke every user's session after a suspected compromise, replace `SESSION_SECRET` with a new random value of at least 32 characters and restart every running app instance. The authenticated smoke and business workflow tests read `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`; keep those values private.

## Day-to-day helpers

- `Start Yogurt Web.command` — starts the already-built production server in the background. It does not open a browser or steal focus.
- `Stop Yogurt Web.command` — stops only the Yogurt Web PID recorded by this project.
- `Yogurt Web Status.command` — checks web health, PostgreSQL readiness, `DATABASE_URL` and recent server logs.

## Data integrity rules

- Store removal is a **soft deactivation**. It is blocked while a store has active refill work or an outstanding receivable.
- Expense removal is an auditable **void**, not a hard delete.
- Manual raw-material stock changes create `RawMaterialAdjustment` audit records and cannot drive stock below zero.
- Refill lifecycle is `waiting → preparing → delivering → completed` (or cancelled). Completion deducts finished goods using FEFO and refuses completion when central stock is insufficient.
- Weekly restock/settlement rejects stale inventory/refill snapshots, prevents negative sales reconciliation and prevents overpayment.
- Payment and restock POST requests require a UUID `Idempotency-Key` header. The browser saves unresolved requests and retries them with the same key after a reload.
- Production validates raw materials and deducts them transactionally before a finished-goods batch is created.

## Cost / profit reporting

New production batches record `totalMaterialCost` and `unitCost` from the weighted-average raw-material costs at production time. Weekly audits record product COGS per sold SKU. Reports use recorded COGS when the relevant data has complete cost lineage.

Historical/demo rows that do not yet have recorded cost lineage are explicitly shown in **estimated** mode and use the previous 28% sales-cost fallback for those missing rows. Once real material receipts, production and weekly audits are recorded, the report switches to actual recorded COGS.

## Demo fallback

If PostgreSQL becomes unavailable, users with a valid signed session can open the read-only overview pages using `src/data/demo.ts` through `src/lib/db-data.ts`. Detail and editing pages return to the overview. Mutating buttons are disabled in fallback mode. A new login requires PostgreSQL. Password resets and account deactivation cannot be checked while PostgreSQL is down, so an earlier signed session may continue to see static demo data until it expires; it cannot read live operational data or make changes.

## Important local files

- `.env` — local database connection; ignored by git.
- `.yogurt/setup.log` — one-click setup log.
- `.yogurt/web.log` — production server log.
- `.yogurt/web.pid` — PID for safe project-local stop.

Do not commit `.env` or local runtime logs.
