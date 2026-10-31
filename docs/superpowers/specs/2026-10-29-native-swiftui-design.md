# Native SwiftUI migration

Status: owner chose SwiftUI-first with the existing computation/backend retained on 29 October 2026. Implement in a separate native application, preserve the working Electron app/profile until native verification is complete.

## Outcome

Real Swift/SwiftUI/AppKit views for the current Mac workflows, not an Electron or WKWebView wrapper. Keep existing Supabase, Prisma transactions, accounts/roles, exact money rules, audit and idempotency. Node remains a bundled internal backend in this approved phase; no website hosting or always-on service is introduced.

Target arm64 Mac, deployment macOS 15+, Swift 6 toolchain. Product language remains Lao, with Noto Sans Lao bundled under its OFL license. Native chrome follows macOS; workspaces preserve PRODUCT.md/DESIGN.md category colors and trustworthy dense operations hierarchy.

## Architecture

SwiftUI views → asynchronous native API/session/command actors → capability-protected loopback Next/Prisma backend → existing Supabase. Swift uses an ephemeral URLSession, rejects redirects and scopes credentials to `http://127.0.0.1:43188`. It manually stores/sends only the server's expected yogurt_session cookie through a private Keychain session adapter; account passwords are never retained. Validate revocation/role with /api/session before mutations.

Bundle a pinned official darwin-arm64 Node LTS runtime verified against its official checksum manifest; no system Node/npm/Homebrew dependency. Swift owns an app-only native supervisor and Node child. Versioned NDJSON bootstrap/ready/heartbeat/shutdown/failure control uses pipes; no secrets in argv/logs. Supervisor independently kills the owned Node process group after parent death or an enforced shutdown deadline, including a hung JS event loop. No LaunchAgents, login items, tunnels or persistent supervisor.

The GUI creates its window immediately and renders a native startup state while the backend connects. Main actor handles presentation only; decoding, networking, credential storage and durable command I/O stay off the UI path. In-memory read results can remain visibly stale during a refresh; authorization, quotes and compare-and-swap snapshots are always fresh for writes.

## Backend interface

Add GET-only `/api/native/v1/[resource]` adapters with explicit resource/role policy and bounded projections. Successful reads return `{version:1,resource,source,generatedAt,data}`; source is `database` or visibly degraded/demo. Preserve ISO timestamps, date-only strings and exact decimal strings for editable values. Return 401/403/404/503 truthfully. No arbitrary Prisma-model access or unrestricted all-data payload.

Resources: overview, stores, store (id), map, refills, restock (id), inventory, production, settlements, expenses, expense (id), reports, notifications, operations, fridges, audit, catalog. Filters use validated query/filter/page/period values. Existing mutations keep their current endpoints, payloads, role checks and transactional semantics. Native namespace read policy must account for production read-only refills and driver product choices without expanding mutation permissions.

Avoid broad list queries for a single store/edit form. Parallelize independent reads where the current source has sequential waterfalls; measure server/database wait separately from native render/input responsiveness. Keep the existing web/desktop routes intact.

## Native workflow parity

1. Login/logout, session expiry/revocation/role changes, startup errors and reconnect.
2. Today overview: attention, counts, due stores/refills, low stock and role-filtered navigation.
3. Stores list/search/filter/sort, detail, create/edit/archive, contextual refill/audit/payment.
4. Native MapKit map plus usable list fallback, store selection, directions and filters.
5. Refill queue/filter/detail/create/per-SKU counts and valid lifecycle/cancellation/completion.
6. Driver queue and dedicated count → payment → review/confirm audit. Preserve current stock, refilled count, financial snapshot, commission and receipt. Payment-only does not create a new stock audit.
7. Settlements latest-per-store/history filtering/pagination, payment entry and persisted receipt.
8. Inventory list/filter/export, receiving, adjustment/reason and metadata/stock editor.
9. Production planner/material availability/costs, product/recipe selection, batch creation, central waste and active/history batches.
10. Expenses filters/pagination/export, create/edit/category/receipt attachment, preview/save and reasoned void.
11. Reports periods/ranges, financial/store/product results, cost provenance and export.
12. Operations product/material/recipe management/versioning, date-based closing with exact snapshot/conflict behavior and truthful backup readiness.
13. Fridge assets/assignment/maintenance safety, notifications, audit history/diffs/filter/pagination/export.

These represent the existing 24 page templates and embedded flows. Do not replace domain workflows with a generic database-row viewer or omit features behind placeholder buttons. Dormant user management remains dormant.

## Recovery and local data

Swift Keychain generic-password items store the chosen Supabase connection, persistent signing secret and session separately. Use login/file-based Keychain semantics compatible with a local ad-hoc owner build; fail closed on denial. Re-import the local private .env for the new app; do not try to decrypt Electron safeStorage format as native Keychain data. Never seed/reset/copy/migrate the live database on startup.

Native client state lives under `~/Library/Application Support/Yogurt Manager Native` with 0700 directories/0600 files. Existing private receipts and backup evidence stay accessible through the approved existing runtime root; the old browser/config directories remain intact. Before native writes are enabled for handoff, export known old draft/pending keys through the trusted old client's storage API, preserve raw UUID/body/account/store/snapshot context, and import or present any unresolved records for reconciliation. No opaque LevelDB parsing or deletion.

Durable native commands persist user + method + route + exact serialized body + lowercase UUID before network send. Retry that same body/key after uncertain response; resolve an earlier different pending command first. Preserve on auth failure/5xx/transport errors; clear only confirmed success or definite rejection. Never apply durable replay to endpoints without that server contract. Loaded edits and daily closings retain original snapshots; dirty dismissal/navigation must offer cancellation rather than silently discard work.

Normal close/Cmd-Q shares a single graceful shutdown path; final-window close quits. The supervisor enforces cleanup on startup failure, crash/force quit and hung Node. Native app owns only its own processes and refuses port collision without killing other programs.

## Verification and handoff

- Swift unit tests for precise JSON/money input, session origin/cookie handling, role policy, command persistence/unknown results, response errors, draft ownership and import.
- Existing Node suite plus native read API auth/role/projection/failure tests; no weakening existing business checks.
- Full synthetic local DB native login/read/write/receipt/replay tests, existing business/FEFO/conflict suites and outage/reconnect.
- Native rendered UI verification covering the full sidebar, tables/forms, Mac keyboard/focus, loading/error/empty states and Lao font shaping. No claimed usability/performance evidence from source inspection alone.
- Installed self-contained app outside repository with spaces in path; no Electron/Chromium/WebView or external Node dependency. Test duplicate launch, collision, failure, final-window close, Cmd-Q, force quit and deliberately hung backend cleanup.
- Scan app and mounted installer for actual private values/runtime artifacts; preserve credentials in Keychain. Real Supabase handoff uses read-only connectivity checks, never synthetic business writes.
- Install new native app alongside the original until parity and recovery are verified, then provide clear launch choice and source handoff. Keep original recovery data and application available; no new cloud hosting/account purchase.

No existing desktop acceptance is presented as proof of this new native implementation. Report actual verified scope and remaining limitations.
