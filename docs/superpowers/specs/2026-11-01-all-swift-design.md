# All-Swift Yogurt Manager

The owner explicitly requested on 1 November 2026 that the installed application's remaining Node/Next/Prisma processing be replaced by Swift. This supersedes the earlier UI-only migration scope. The objective is a SwiftUI application whose business processing and database access run in Swift, without a bundled JavaScript runtime or loopback web backend. Supabase PostgreSQL remains the existing database.

## Boundaries

- Preserve the current Lao-first SwiftUI workspaces, recent inventory design, display cache and durable operation/draft recovery.
- Preserve the existing database schema, users, scrypt password hashes, revocable session rows and 12-hour signed session format. Do not reset accounts or replace them with Supabase Auth.
- Preserve public API denial/RLS configuration. Use the owner's existing private PostgreSQL configuration from Keychain; never embed credentials or introduce public service keys.
- No live database writes, migrations, seeds or synthetic business records for verification. Use the isolated PostgreSQL fixture and private scratch roots.
- Keep the currently installed application available until the replacement passes business acceptance. Preserve the previous bundle and data for rollback; do not remove pending drafts or receipts.
- "All Swift" refers to application UI, orchestration, authorization and business logic. PostgreSQL SQL, Apple's frameworks and native dependencies remain normal platform infrastructure. Build/test tools and the archived web implementation may remain in the repository but are not shipped in the new bundle.

## Architecture

SwiftUI → actor-isolated SwiftEngine → pooled PostgresNIO connections → existing Supabase PostgreSQL. The app does not listen on a local TCP port. UI code keeps the existing JSON response envelope while the transport becomes direct in-process calls. Keeping this boundary makes parity observable and preserves durable UUID/body behavior.

The engine returns an EngineReply (status, JSON data, optional binary bytes/content type, optional session cookie). Existing NativeReply remains the UI-facing shape. A Swift authentication service checks the signed session, current user/session row, password credential tag and current role. Every mutation checks identity again inside its serializable transaction; cached display data never authorizes a command.

Database helpers bind all values. Identifiers come only from fixed source-controlled SQL. Exact decimals cross the database boundary as decimal values or strings; no Double arithmetic determines stored money or stock. PostgreSQL constraints remain authoritative.

Serializable transactions retry only confirmed serialization/deadlock/known idempotency uniqueness conflicts, with bounded attempts/backoff. Connection loss during commit remains uncertain and does not mint a new operation key. Existing operation receipts, request hashes, scopes and persisted result shapes remain compatible with the web implementation.

## Compatibility requirements

- Money scale 2, commission scale 4, material quantity scale 6, recipe quantity scale 4 and unit cost scale 4. Preserve rounding rules and FIFO lot costing.
- Preserve active/inactive user checks, password-reset revocation, session logout/revocation, role changes and login lockout behavior.
- Preserve inventory receive/adjust CAS, product/material changed-only edits, recipe version/snapshot behavior, production/waste stock invariants, refill lifecycle/FIFO allocation, restock financial snapshot validation, settlement history and balance reconciliation, expenses/voids and daily-closing snapshots.
- Preserve bounded reads, exact editable fields, reports' half-open Laos date ranges, roles' sensitive-field restrictions, audit metadata filtering and private receipt access.
- Preserve safe per-project runtime roots, private files, receipt legacy-path normalization and backup-readiness evidence semantics. No secret-bearing errors/logs.
- Map place search remains async with bounded/validated external requests, cancellation and existing attribution.

## Verification and cutover

A verification-only stdio engine entry point accepts a private bootstrap frame and request frames, only for the local `yogurt_e2e_*` fixture database. It exposes no listener and prints only protocol frames. This allows the existing 626-check packaged acceptance suite to exercise Swift processing with the same fixtures and expected results. The legacy packaged backend remains the comparison oracle during development.

Cutover requires the full Swift unit suite; differential decimal/auth/idempotency vectors; all native read roles/projections; isolated receive/production/refill/restock/payment/expense/closing workflows; replay and concurrency invariants; receipt ownership/permissions; fresh role/revocation checks; and a native installed-app pass. Inspect the built bundle for absence of Node, Next, Prisma, JavaScript bootstrap and supervisor helper. Measure cold startup, first load and return navigation; report network-dependent limits without inventing a global speed percentage.
