# Deploying later with the existing Supabase database

The GitHub repository holds the application source and migration history. The application's data stays in the existing Supabase PostgreSQL project. Pushing/cloning code does not move or recreate that database. There is no automatic website deployment configured here.

The owner retired public hosting on this Mac on 29 October 2026. The web server, dedicated Yogurt Cloudflare tunnel, health monitor, backup schedules and local maintenance PostgreSQL service are stopped. Their private files/data remain local for recovery. Do not restore those services unless explicitly requested.

## Configure the host

Use a host that can run this Next.js application with server-side Node.js code and reach Supabase PostgreSQL. Set environment variables privately in that host's configuration:

- `DATABASE_URL`: the existing Supabase project's PostgreSQL connection string. Use that project's own Session pooler details from Supabase Connect, URL-encode password characters, and retain the required SSL connection option. `.env.example` contains placeholders only.
- `SESSION_SECRET`: a secret of at least 32 random characters, supplied privately. It must be consistent across app instances. Replacing it invalidates existing signed sessions.
- `PUBLIC_BASE_URL`: the new website's HTTPS origin when it is known. Review origin/proxy settings against the selected host before opening traffic.
- Optional operational settings are listed in `.env.example`. `LOCAL_DATABASE_URL` is only for local restore/E2E tools; the hosted website uses `DATABASE_URL`.

The current users already exist in Supabase. Do not run a demo seed, `prisma migrate reset`, `prisma db push`, database-copy/move helpers or the Mac setup launcher against the existing database to prepare hosting. Initial-admin environment settings are for first setup or deliberate account management, not a requirement to recreate current users.

## Build and start when ready

From a checkout with private environment configuration available:

```sh
npm ci
npx prisma generate
npm run build
npx prisma migrate deploy
npm run start
```

Apply migrations once during a controlled release using the existing backend database role. All 16 migrations were applied and reconciled during the last verified release; future additions should remain additive. `npm run start` starts the web server intentionally, so run it on the selected host when deployment is desired. These commands are instructions, not an automatic deployment workflow.

Payment-slip uploads currently use the private `.yogurt/private-receipts` directory. A future host needs suitable persistent private storage or an intentionally implemented storage integration; database hosting alone does not persist those files. Receipt images/backups are not in GitHub. At the last verified backup there were no receipt files to transfer.

## Verify the new deployment

Check login, role permissions, stores/refill handoffs, production, expenses, reports and financial retries with approved test data before admitting actual work. Configure backups, restore verification and monitoring for the new environment. The former Mac schedules are disabled and should not be counted as active protection.

See [Operations and recovery](OPERATIONS.md) for database isolation and backup/restore behavior. The historical readiness/UI reports document the scope of earlier tests; they do not certify a newly chosen hosting environment.
