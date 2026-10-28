# Readiness Hardening Implementation Plan

> **For agentic workers:** Use subagent-driven-development for independent tasks; root integrates and verifies deployment boundaries.

**Goal:** Resolve the user-approved findings in READINESS_AUDIT_2026-10-28.md without changing the approved business/design model.

**Architecture:** Retain Next.js/Prisma, custom CSS, exact money, Serializable transactions, and durable idempotency. Add narrow guards and portable operations helpers. Keep production serving while implementation and verification run in this isolated worktree.

**Tech Stack:** Next.js 15, React 19, TypeScript, Prisma 6, PostgreSQL, Node test runner, macOS launchd.

**Spec:** READINESS_AUDIT_2026-10-28.md, approved by the user's request to implement its recommendations.

## Global constraints

- Preserve Lao-first operations, canonical colors/font and root app reexports.
- No destructive production reset or reseed. No real credentials in tests/logs.
- Backup/recovery tests use scratch databases and dedicated ports; no builds over running production.
- Schema changes use new additive migrations, not edits to previously applied files.
- External backup/alert destinations await the user's chosen destination; implement and verify the local integration meanwhile.

## Review focus

- Existing closing, stale edit and concurrent first create must preserve the original record or return conflict.
- Concurrent login attempts must reserve their IP budget before async password verification.
- A backup from a different DB target, failed latest attempt or unverified restore cannot report full readiness.
- Refresh/navigation/storage failure must not falsely claim a driver draft is saved or duplicate a payment.
- API-role restrictions must block anonymous reads/writes without breaking the backend's normal SQL operations.

## Tasks

- [x] Security: tests first for generic CSV neutralization and concurrent login cap; fix the actual consumers. Add portable, conditional Supabase API-role revoke/RLS migration and a reusable hardening script for newly copied databases. Verify against local fixtures before applying grants in production.
- [x] Operations: execute scripts with controlled dependencies to reproduce DR failure; implement application-only portable dumps, target fingerprints, failure/restore state, retries and working DR/business runner. Use ephemeral test admins and independent source/scratch URLs. Verify real Supabase read-only dump → scratch restore → app/E2E; no shared production writes.
- [x] Finance: reproduce closing overwrite and stale edits in route tests. Add authenticated GET date lookup; POST compares expected snapshot inside idempotent Serializable transaction and returns conflict on stale/missing edit snapshot. UI loads saved amounts and preserves drafts when refresh fails.
- [x] UI recovery: implement honest driver autosave/dirty navigation, live errors, role-filtered map actions, recoverable search/map failures, honest error copy, shell skip link, and 44px driver targets. Run Impeccable context and current web guidelines, retain design direction.
- [x] History/docs: corrective waste-cost provenance migration; audit migration checksums against historical content without resetting records. Update Supabase runbook and interface system memory. Add guarded clone integration coverage for FEFO/concurrency/closing.
- [x] Review and release: independent security/finance/operations/UI reviews; full unit/lint/typecheck/schema/build and E2E on scratch; apply migrations/security grants, take and verify backup, deploy tested build with rollback, verify public/local health. Record actual limits for offsite/alerts/mobile/load testing.

## Execution ledger

- Baseline: audit found 124 passing unit/regression tests; production serves port 3000. Isolated branch codex/readiness-hardening created with native worktree tool.
- Ruling: existing report and the user's explicit instruction approve its concrete fixes; do not repeat design/permission gates for the same scope.
- Ruling: backend-only Prisma tables will deny Supabase client API roles; do not introduce permissive RLS policies or change the application's authentication provider.

- Review evidence: security/finance/history review found no blocking issue. Independent operations review found libpq target overrides and missing-artifact false readiness; both reproduced and fixed with behavioral tests.
- Verification: 168/168 tests, schema/lint/typecheck/production build, authenticated/business/readiness E2E, offline E2E and full restored-data DR passed.
- Rendered QA: 515px mobile pane and 1280x720 desktop; closing edit retained 110/200/30, Radix cancel preserved edit, driver draft restored counts/payment/method. Desktop closing disclosure was discovered hidden and switched to the existing ResponsiveDisclosure component; confirmed visible with loaded amounts.
- Live database: 16 additive migrations applied after verified backup; API-role exposure query returned0, both anon/authenticated user reads denied, backend normal reads valid, migration checksums all match. No live business rows were seeded or reset.
- External configuration: user choice of offsite destination and Telegram/webhook is still pending; integration tested using temporary directories/synthetic passphrases.
- Release: fast-forwarded master to 3511878 and ran Apply Yogurt Update successfully. Pre-deploy 168 tests, real Supabase backup/restore, build, migration and unauthenticated checks passed. Restored archived job definitions; daily backup now uses backup-and-verify.sh; dedicated Yogurt tunnel is distinct from the existing system tunnel. Server/tunnel/health/daily/weekly jobs and local scratch PostgreSQL are loaded.
- Post-release: public/local health ok; full DR passed against the deployed build and latest backup at 19:03 Asia/Vientiane. Live RLS26/26, exposed API-role tables0, both user reads denied, all16 migration checksums match. Details and remaining external/mobile/load limits: READINESS_FIXES_2026-10-28.md.
