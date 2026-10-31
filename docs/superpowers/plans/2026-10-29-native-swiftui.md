# Native SwiftUI Implementation Plan

> **For agentic workers:** Use subagent-driven-development for independent backend and native domain views; root owns shared native services/runtime and integration. Resume from the per-plan private ledger after compaction.

**Goal:** Ship a real SwiftUI Mac client with full reachable workflow parity and the existing validated local backend/Supabase.

**Architecture:** SwiftUI native workspaces and asynchronous session/API/command services; a bundled official Node runtime supervised by an app-only native helper; versioned authenticated JSON read adapters plus unchanged transactional mutation endpoints.

**Tech Stack:** Swift/SwiftUI/AppKit/MapKit, Foundation URLSession, Security Keychain, existing Next15/Prisma6, official Node LTS, Node/Swift test runners.

**Spec:** docs/superpowers/specs/2026-10-29-native-swiftui-design.md

## Global constraints

- Owner selected SwiftUI-first with the existing computation/backend retained; no Electron/Chromium/WKWebView in the new application.
- Native service origin http://127.0.0.1:43188; old app/profile retained and port43187 unaffected.
- Preserve Lao-first design, approved domain colors, exact editable money strings, dates in Asia/Vientiane, current admin/production/driver policy.
- No live seed/reset/migration/business test writes; scratch data only for transactions.
- No permanent services, embedded secrets, plaintext credential fallback, arbitrary SQL/model API or automatic replay of uncertain writes with new keys.

## Review focus

- A lost payment response survives native restart and cannot duplicate money: Tasks2/5.
- Swift URLSession handles only its exact owned cookie/origin and refuses redirects: Tasks2/5.
- Parent death with a hung Node event loop leaves no child process: Tasks3/5.
- Every existing reachable action has a real native flow with roles/conflict states: Tasks4/5.
- Old pending drafts remain recoverable and cannot replay under another account/project: Tasks2/5.

### Task1 — Native read adapters and query scope

Own src/lib/native-data.ts, src/app/api/native/v1/[resource]/route.ts, root app re-export, explicit native read policy and Node tests. Reuse existing calculations/projections with domain-specific raw edit fields; apply role rules/resource allowlist and error/freshness envelope. Improve narrow store/edit reads and overlap independent production work without changing business rules. Document exact JSON keys consumed by native views.

- [ ] Write failing auth/role/projection/resource/error tests.
- [ ] Implement read adapters and scoped query improvements; test and typecheck.

### Task2 — Native shared client/session/recovery

Own native/Package.swift, native/Sources/YogurtNative/Core and shared Views/Components.swift plus tests. Provide JSONValue, FeatureState, AppModel, APIClient actor, Keychain store and durable OperationStore. Use manual scoped session cookie adapter and fresh session identity before writes; persistence precedes send. Add native file import/export/receipt preview, generic simple editor primitives and domain-specific helpers. Bundle OFL Noto Sans Lao and existing brand assets.

- [ ] RED→GREEN tests for origin/cookie, errors, durable commands, definite versus ambiguous result, exact money input and ownership.
- [ ] Compile native shared interfaces before domain integration.

### Task3 — Runtime and packaging

Own native/runtime bootstrap, app-only supervisor, Swift BackendRuntime, Info.plist and build/package scripts. Verify official Node archive, stage existing secret-free backend and arm64 Prisma engine. Native stdio bootstrap/control must not expose secrets. Main UI opens immediately; supervise all shutdown cases including a blocked event loop.

- [ ] Test control parser, collision, parent/EOF cleanup and hung child termination.
- [ ] Build .app/.dmg with native executable, helper, Node and server assets; inspect actual payload and checksum.

### Task4 — Native domain workspaces

Split ownership into OperationsViews.swift (stores/detail/create/edit/map/refills/driver/restock/payment/settlements) and ManagementViews.swift (inventory/production/expenses/reports/operations/fridges/audit/notifications). Root provides app shell/login/overview/navigation. Domain views consume the shared contract and real endpoints; preserve snapshots and contextual handoffs. Native tables/sheets replace HTML, not a WebView. Preserve all loading/empty/error/dirty/role states.

- [ ] Implement dedicated reachable workflows with real payloads and no placeholder actions.
- [ ] Build and use synthetic data to exercise every sidebar destination and critical forms.

### Task5 — Full verification, migration and installation

- [ ] Run Swift/Node checks and existing business suites with new JSON read coverage.
- [ ] Test actual native app against isolated local DB including auth, stock/financial replay, receipts/export, conflict and outage/reconnect.
- [ ] Inspect real Mac UI/font/keyboard/states, fix a single batched round and confirm.
- [ ] Export/import or visibly reconcile old pending state through trusted client storage; preserve originals.
- [ ] Scan native app and mounted DMG for actual secrets, verify no outside runtime/browser dependency and process cleanup.
- [ ] Install alongside old app, privately configure existing Supabase, check production read-only and hand off with verified scope. Commit/push safe source to the already requested repository.

The owner explicitly selected this migration approach in chat. Preserve their authorization and execute routine technical steps without repeated permission prompts; obtain missing operational input only if required to protect active unsaved user work.
