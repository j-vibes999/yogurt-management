# Mac desktop verification — 29 October 2026

The arm64 desktop application was packaged, copied outside the repository into a path containing spaces, exercised with synthetic data, and installed at `~/Applications/Yogurt Manager.app`.

## Evidence

- Unit tests: **216 passed**, no failures or skips. ESLint and TypeScript checks passed.
- Actual Electron production-package acceptance: **11 checks passed**; details in [results.json](results.json).
- Installed backend business verification: authenticated smoke, business workflow, and readiness suites passed against an isolated local PostgreSQL database. This includes FEFO/expiry, competing stock demand, atomic shortage rollback, financial idempotency and closing-edit conflicts. These suites used Node with the installed package's Next/Prisma payload and desktop capability/shared-pool configuration; they are API verification rather than Electron UI tests. See [business.json](business.json).
- Actual package tests cover Secure/HttpOnly/Strict cookies from the app's persistent partition, native Prisma, receipt migration and uploads, CSV export, separate receipt preview, last-window close, duplicate launch, interrupted financial-response recovery across restart, database outage/reconnect, and force-quit listener cleanup.
- Actual `.app` and a read-only mounted DMG were checked against five variants of the local private database/session credentials across **5,276 files**, with **zero matches**. Required Next manifests/static assets and native arm64 Prisma engine were present. See [artifact-audit.json](artifact-audit.json) for installer checksum and size.
- `npm audit`: **0 vulnerabilities** at handoff.
- The installed app imported the existing private settings and reached the existing Supabase database through a read-only health query (HTTP 200, database connected). **No production business test transactions were created.** Both existing source receipt directories were empty; synthetic migration/persistence cases were tested separately. See [installation.json](installation.json).

## Material integration fixes

Next.js middleware's loopback hostname normalization initially moved redirects away from the exact app origin; the desktop build preserves the chosen origin. Native Prisma could retain a warmed pool of closed sockets after PostgreSQL restarted; desktop authorization reads now share one pool and perform a single coordinated reconnect/read retry for connection failures. Business writes retain the existing uncertainty/idempotency behavior and are not automatically replayed by this recovery helper.

Interrupted first configuration publication is recoverable through a narrowly validated stale temporary hardlink. Receipt imports are checksum-verified before settings are published, and receipt previews preserve the main workspace. Manual backup/recovery tools honor the app's writable data root; scratch E2E tools cannot inherit its private receipts directory.

## Scope and operating limits

This is a local-use, unsigned/ad-hoc Mac build, **not notarized for public distribution**. Internet remains necessary for real Supabase reads/writes. The owner's trusted Mac holds backend database credentials in Keychain-backed encrypted configuration; this model must not be distributed unchanged to untrusted employee computers.

Retired public hosting, tunnels, login/background jobs and maintenance PostgreSQL remain stopped. Closing the app stops its owned backend; the force-quit test also verified eventual listener cleanup. The desktop app's backup readiness is **unverified** until manual backup/restore evidence is generated in its data directory. The old scheduled jobs were deliberately not re-enabled. Source backup history and the original database were retained.

Screenshots show synthetic fixture data: [login](login.png), [dashboard](dashboard.png), [operations](operations.png). Existing Lao-first UI/business logic was preserved. Intel/Windows, notarized distribution, performance/load capacity and a complete offline synchronization system were outside this change.
