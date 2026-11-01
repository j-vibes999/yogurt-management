# Native navigation performance — 1 November 2026

The owner reported delays when switching pages and waiting for data. This change keeps the last successful workspace response in memory for immediate display while a fresh server request runs. The cache is display-only: forms and financial/stock commands still fetch current server data and retain their existing authorization, snapshots and idempotency behavior.

## Changes

- Workspace snapshots are keyed by account, role, resource and normalized filters. The cache holds at most 16 responses, each at most 2 MiB of JSON. It is never written to disk. Demo/offline responses and form resources (`store`, `restock`, `expense`, `catalog`, `closing`) are excluded.
- A recreated workspace displays matching cached content with an explicit Lao refresh notice. Query changes clear the previous results. Errors mark retained content stale; account/role/source changes discard it. Every page entry still refreshes from the server.
- Session changes and every attempted command invalidate the cache. A generation check prevents an older in-flight response from repopulating it after a write, including uncertain outcomes.
- Known native GET handlers perform their fresh database session/role check once, in the route. Middleware still verifies the signed cookie and applies security headers. Writes, other APIs and unknown resource names retain the middleware database check. No client-supplied authorization context is trusted.
- Native inventory derives display numbers and exact editable decimal strings from one material query, replacing two parallel material reads.
- Map placement waits for fresh directory data and reads the current store before submitting the required name. Receipt opening/export waits for fresh financial data. Report period labels/CSV match the cached query even if refresh fails.

## Before/after evidence

| Behavior | Before | After |
|---|---|---|
| Return to a visited workspace | No retained content; wait for network | Matching content is available before the fresh read completes |
| Fresh session validation per known native GET | Middleware plus route | Route once |
| Inventory material reads | Display and exact-edit reads | One shared read |
| Financial forms | Current reads and server snapshots | Current reads and server snapshots |

The production Supabase read-only benchmark showed approximately 40–100 ms per warmed database round trip. Network variation prevented a reliable overall speed percentage: inventory data-loader times were around 85–91 ms before and 82–97 ms after, because its old reads ran in parallel. The primary gains are immediate cached display, one fewer fresh session validation, and less duplicate database work. These loader timings exclude the HTTP authorization path and rendering; they are not end-to-end app timings.

## Verification

- Swift: 41 tests passed, including cached content visible while a fresh read is suspended, account/role/query isolation, failure states and rejection of pre-write cache generations.
- Node: 251 tests passed; typecheck passed; ESLint reported zero errors and one existing unused-import warning in the ignored desktop verification script.
- Actual packaged backend: 626 checks passed against isolated PostgreSQL; zero live configuration used. Includes all native resource role checks, immediate role downgrade, disabled user and revoked-session rejection, exact money/stock values, replay/conflicts and private receipts. PostgreSQL and the app port were cleaned up.
- Release packaging and code-signature verification passed. Installed-app UI validation passed for overview, stores, inventory, production, settlements, map, reports and revisiting pages. Native screenshot inspection found no material layout defect in the changed loading surface. Live UI navigation was read-only and created no business transactions. The app was closed after validation and its backend stopped.

The previous installed app is preserved outside the repository for rollback. No services, tunnels, database schema or permanent background jobs are added.
