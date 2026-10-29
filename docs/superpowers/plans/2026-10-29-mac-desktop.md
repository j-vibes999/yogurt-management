# Mac Desktop Implementation Plan

> **For agentic workers:** Use subagent-driven-development for the independent storage and configuration tasks, then integrate and review the packaged application. Steps use checkbox syntax for tracking.

**Goal:** Install Yogurt Manager on the owner's arm64 Mac, using the existing Supabase database, with no backend remaining after the app exits.

**Architecture:** Electron owns a bundled production Next.js backend and a persistent, isolated browser session. The backend binds to a stable loopback origin and authenticates every request using a per-launch capability. Configuration is encrypted by macOS Keychain-backed Electron safeStorage; mutable files live outside the application bundle.

**Tech Stack:** Existing Next.js 15 / React / Prisma 6, Electron 45.1.0, electron-builder 26.18.0, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-29-mac-desktop-design.md`

## Global Constraints

- Target the owner's darwin-arm64 Mac; preserve Lao-first UI and existing business logic.
- Stable origin `http://127.0.0.1:43187`; no silent port fallback or attachment to another server.
- No production seed/reset/copy/migration or business test mutations. Use isolated local scratch data for write tests.
- No LaunchAgents, autostart, tunnels, maintenance PostgreSQL services, or permanent background app.
- No credentials/private runtime data in GitHub or packaged artifacts. No plaintext configuration fallback.
- Installed app must not depend on external Node/npm/Homebrew. Close, failure and parent death must terminate the owned backend.

## Review Focus

- Interrupted financial requests and origin-scoped drafts must survive restart without duplicate commits: Task 5.
- Port collision and ordinary browser requests must fail without reaching privileged routes: Tasks 3 and 5.
- Keychain denial, corrupt config, symlinks, and interrupted receipt import must not expose secrets or destroy source files: Task 2.
- Packaged paths containing spaces and Prisma native engine loading must work outside the source checkout: Tasks 4 and 5.
- Closing/force-quitting during startup or a request must leave no owned listener/process and must preserve recovery data: Tasks 3 and 5.

### Task 1: Explicit mutable-data root

**Files:** Create `src/lib/runtime-paths.ts`, `tests/runtime-paths.test.mjs`; modify receipt-storage, backup-readiness, operations, health and web-vitals route only where filesystem roots are resolved.

**Interfaces:** `runtimeDataDirectory(rootDirectory?: string, configuredRoot?: string): string` returns absolute `YOGURT_DATA_ROOT` when configured, otherwise `<rootDirectory>/.yogurt`. Existing receipt/backup function signatures remain compatible. Build metadata continues using the immutable application root.

- [x] Write failing tests for explicit data-root receipts and backup evidence, legacy fallback, invalid relative root, and independent build-metadata location.
- [x] Run focused tests and confirm the missing behavior fails.
- [x] Implement the helper and surgical call-site changes; preserve 0700 directories / 0600 private files.
- [x] Run focused tests, lint and typecheck; inspect the diff.

### Task 2: Private desktop configuration and receipt import

**Files:** Create `desktop/config.cjs`, `desktop/import-receipts.cjs`, `tests/desktop-config.test.mjs`, `tests/desktop-receipts.test.mjs`.

**Interfaces:** `loadConfiguration({safeStorage,directory})` returns `{databaseUrl,sessionSecret}` or null for absent config. `importConfiguration({safeStorage,directory,envPath})` reads an allowlisted DATABASE_URL from a local env file, validates a PostgreSQL Supabase connection with TLS, generates/preserves a random session secret, encrypts and atomically stores it. `importReceipts({sourceDirectory,directory})` copies valid private receipt files into `<directory>/private-receipts`, verifies checksums, skips identical existing files and refuses conflicts/symlinks without deleting sources.

- [x] Write failing tests with an injected encryption adapter for no plaintext persistence, encryption unavailable, corrupt input/config, permissions and persistent secret across re-import.
- [x] Write failing tests for safe receipt copy, duplicate same hash, conflicts, interrupted copies and symlink rejection.
- [x] Implement main-process-only modules with generic errors; use Electron 45 async safeStorage APIs.
- [x] Run focused tests and inspect outputs/diff. Never read or print actual secrets in tool output.

### Task 3: Owned backend and secure Electron shell

**Files:** Create `desktop/local-server.cjs`, `desktop/backend.cjs`, `desktop/main.cjs`, `tests/desktop-server.test.mjs`; modify `middleware.ts` for internal session capability forwarding.

**Interfaces:** Child receives application root, data root, database/session configuration and fresh capability through private environment. It emits readiness/failure messages, handles shutdown messages and expires when parent heartbeat disappears. Shell injects `x-yogurt-desktop-token` only for its own exact origin; backend verifies it and the Host/Origin before Next handles any request.

- [x] Write failing tests against a stub handler for missing/incorrect token, wrong Host/Origin, no token leak in errors, stable port collision and graceful shutdown.
- [x] Implement guarded loopback server with production Next handler and a readiness endpoint independent from DB/backup status.
- [x] Implement single-instance Electron app, strict renderer isolation, Keychain-backed config import, persistent browser partition, explicit download handling, navigation restrictions and native recovery dialogs.
- [x] Implement bounded graceful shutdown, parent heartbeat cleanup and last-window-close/Cmd-Q behavior.
- [x] Forward capability in existing internal session fetch without changing public hosted behavior.
- [x] Run focused tests and real Electron launch against isolated configuration.

### Task 4: Self-contained application packaging

**Files:** Modify package.json/package-lock.json, next.config.ts, .gitignore/eslint ignores; create `scripts/build-desktop.mjs`, `scripts/package-desktop.mjs` and packaging configuration.

**Interfaces:** `npm run desktop:build` builds standalone Next with placeholder-only environment and stages an allowlisted backend under `build/desktop/backend`; `npm run desktop:package` produces darwin-arm64 app/DMG under `dist-desktop`. Electron entry is `desktop/main.cjs`. Immutable backend root is `<resources>/backend` when packaged; mutable root is `<userData>/runtime`.

- [x] Add pinned Electron/build tooling, with no broad unrelated dependency upgrades.
- [x] Enable conditional standalone output; explicitly stage public assets, .next/static, generated Prisma engine/client and required Next dependencies.
- [x] Exclude .env*, private .yogurt data, source secrets, tests and dumps from artifacts. Reject credential-like values in staged environment files and scan final payload.
- [x] Build unsigned/ad-hoc local-use app and DMG. Verify native engine loading under the bundled Electron UtilityProcess; bundle official supported Node only if required.
- [x] Run the packaged app outside repository; verify no external Node dependency.

### Task 5: Install, recovery tests and handoff

**Files:** Create desktop verification scripts/report and `docs/DESKTOP.md`; update README and operations instructions for desktop use.

- [x] Run unit tests, lint, typecheck and production desktop build after integration.
- [x] Use a temporary isolated PostgreSQL cluster and synthetic user/fixtures for authenticated production-package checks; stop/remove it afterward without enabling the old maintenance service.
- [x] Test production cookies, role checks, stock/payment idempotency and pending request recovery through quit/restart; verify private receipt persistence and offline/reconnect behavior.
- [x] Test duplicate launch, occupied port, unauthorized ordinary browser access, startup error, last-window close, Cmd-Q and parent force kill. Verify listener/process cleanup after each case.
- [x] Scan app/DMG for actual local secrets and forbidden private files, without outputting their contents.
- [x] Install app to the owner's Applications location, privately import the existing connection and existing receipts, and verify production connectivity read-only. Do not create live business transactions for testing.
- [x] Inspect desktop UI and preserve the existing Lao design. Record the real extent of verification and code-signing limitations.
- [x] Get a fresh whole-change security/quality review, fix material findings, rerun affected checks, then commit completed source/docs. Push source to the already authorized GitHub repository only after secrets checks.

Owner approved the written design and instructed implementation to proceed on 29 October 2026. Technical execution uses the above plan with parallel independent work and review; no new deployment/account purchase is authorized or required.
