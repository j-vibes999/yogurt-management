# Yogurt operations and recovery

## Current hosting status

On 29 October 2026 the owner requested that the code be stored in GitHub and the Mac-hosted website be retired until they deploy it themselves. Yogurt's server, dedicated tunnel, health monitor, daily backup and weekly restore jobs are unloaded and their LaunchAgent files moved out of automatic startup. The local maintenance PostgreSQL service is stopped, with data retained. The existing Supabase database and private local backup files remain unchanged. No background Mac hosting should be restored without an explicit new request.

See [Deploying later](DEPLOYMENT.md). The sections below preserve the previous Mac operating/recovery procedure; job schedules describe that former setup, not active jobs.

## Retired Mac deployment

The Next.js server runs on this Mac at `127.0.0.1:3000` behind a Cloudflare tunnel. `DATABASE_URL` is the active Supabase database. `LOCAL_DATABASE_URL` is the old Mac database; it supplies a local maintenance connection for scratch databases, not the live application's data. Keep credentials in the ignored `.env` (mode 600). The project’s launchd jobs use its original absolute project directory.

The Mac, power, lid/sleep state and internet connection still affect web availability. Moving the database did not move the Next.js process. No concurrent-user capacity is promised without a separate measured load test.

The app's user LaunchAgents are `com.yogurt.manager.server`, `.tunnel`, `.health`, `.backup` and `.backup-verify` under `~/Library/LaunchAgents`. They require this user's GUI login after reboot. The dedicated tunnel is named `yogurt-manager`; this Mac also has a separate system Cloudflare daemon for another tunnel. Check tunnel IDs before treating those processes as duplicates. Do not stop or reconfigure the unrelated tunnel. Daily backup is scheduled at 03:15, weekly restore Sunday 03:45, and health checks every 5 minutes in the Mac's timezone.

## Application database security

The application uses Prisma and its own server-validated sessions. Supabase `anon`/`authenticated` roles must have no table, column, sequence or backend-routine privileges on application data. Migration `20261028090000_backend_api_isolation` enables RLS without FORCE, revokes client/PUBLIC grants on the explicit application inventory, and removes permissive future defaults for the backend creator. Owners/bypass roles retain backend SQL access; managed schemas and extension routines remain outside the inventory.

The Supabase copy helper reapplies the same SQL through `scripts/harden-supabase-api.mjs`, even when migration records were copied. New application tables must be added to that inventory. If Supabase Data API is unused it can also be disabled in its dashboard; permissions are enforced independently of that setting.

Migration `20261028092000_reconcile_recovered_history` records a narrow recovery exception: two migration sources were reconstructed after folder loss in commit `ec21a92`. Only their known original checksum values are normalized, after checking the reconstructed objects' types, nullability, defaults and constraints/indexes. Unknown history/schema aborts atomically. Do not edit old migrations, reset production, or blindly update arbitrary checksums.

## Daily backup and verification

Run `npm run db:backup`. The daily launchd job uses the same `scripts/backup-and-verify.sh` wrapper. It:

1. Dumps public application objects with a PostgreSQL 17+ client, excluding provider extensions, publications and subscriptions. Database reads have bounded retries and preserve SSL settings.
2. Writes a checksum and `.metadata.json` identifying the database by a credential-free hash. Payment slips are archived separately alongside the dump.
3. Copies the dump, metadata and receipt archive to `BACKUP_OFFSITE_DIR` when configured, optionally encrypted using `BACKUP_PASSPHRASE`.
4. Restores into a newly named local scratch database, validates the original rows and receipt archive, then drops that scratch database.

`npm run db:backup:dump` runs only the dump step. It does not establish restore readiness. Raw dump metadata and the latest attempt remain distinct; a failed attempt does not erase the last usable dump. A failure returns a nonzero exit code.

Runtime evidence lives in `.yogurt/backups/latest.json`, `latest-attempt.json`, `last-restore-verification.json` and `last-dr-drill.json`. Every dump also has its own metadata sidecar. Readiness requires the active source fingerprint, backup age <=36 hours, a successful latest attempt, artifact existence/size, and a matching successful restore SHA-256. Equal-size corruption is checked by restore/checksum verification, not by hashing the entire dump on every health request.

Backups keep 14 days locally and 30 days in the configured offsite directory. Supabase provider-managed backups, if any, are separate and were not assumed as a substitute for these application/receipt archives.

## Disaster recovery drill

Run `npm run db:dr-drill`. It checks checksum, restores original data locally, records row counts/invariants before test writes, then creates a synthetic clone-only admin and fixtures. It starts the built app on port 3121 and runs authenticated smoke, business workflow and readiness E2E, including FEFO, competing stock, rollback and closing-edit conflicts. The server and scratch database are removed even on failure; a failed E2E cannot become a successful drill through cleanup.

`npm run test:e2e:business` instead dumps the current active source, creates scratch only through `LOCAL_DATABASE_URL`, and runs those suites on port 3101. Existing ports are refused. Scratch targets reject remote authorities and libpq host/service override options. Never point a test directly at production or seed the live database.

To recover for real, choose and verify the intended backup/target, restore to a compatible replacement database, recover the associated private receipt archive, verify application behavior, then change the production connection. The drill deliberately never overwrites production. Receipt archive integrity is tested; retrieval of historical images requires an archive that actually contains them.

## Offsite files and alerts

Set the user-selected `BACKUP_OFFSITE_DIR` and, preferably, a separately retained `BACKUP_PASSPHRASE`. Each offsite file has a checksum. Encrypted files use AES-256-CBC with PBKDF2/200000 iterations; decrypt the dump, metadata and receipts before verification. Keep the passphrase in a password manager outside this Mac. Do not assume another directory on the same disk is an offsite copy.

Set the user-selected Telegram bot/chat or webhook using `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` or `ALERT_WEBHOOK_URL`. `scripts/send-alert.sh` also records local events and macOS notifications. Only send a test message to a destination the user has authorized. No external recipient or storage location is invented by setup.

The health monitor checks both the local and public URL, distinguishes connection availability from recovery readiness and backs off transient failures. HTTP 200 means the app can reach its DB; inspect the JSON `status`/readiness before treating it as ready for recovery.

## Updating the running app

`Apply Yogurt Update.command` runs tests, takes and restores a backup, stops the server, installs dependencies when the lockfile changed, builds, deploys additive migrations, starts and checks the app. It retains a previous build for rollback. Migrations remain applied if application rollback is required; changes must therefore stay backward compatible.

After release, verify local/public health, unauthenticated access guards and migration status. Keep secrets out of logs. Before enabling actual business work, enter approved stores/fridges/opening stock; clone test fixtures never serve as live business data.
