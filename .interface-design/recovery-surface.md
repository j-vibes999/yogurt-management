# Driver, search, map and shell recovery

Targets: src/components/restock-audit-form.tsx, src/components/crud-forms.tsx, src/components/global-search.tsx, src/components/store-map.tsx, src/components/app-shell.tsx, src/app/map, src/app/error
Mode: Operate
Purpose: drivers and office staff retain operational input, identify uncertain results and continue through recoverable failures.

Preserve DESIGN.md, the existing Lao-first hierarchy, custom CSS, Noto Sans Lao and approved category colors. Draft status must describe browser persistence of the current counts, amount and payment method. Autosave retains account/store namespaces and rejects changed stock/financial snapshots. Storage failure keeps values visible, explains the limitation and guards exit. Unresolved financial commands retain their original key/body.

Dirty page-changing links use the established Radix confirmation dialog; pristine or confirmed-success forms navigate without a prompt. Async errors are announced and focusable. Search distinguishes loading, current empty results and retryable failure; old responses cannot replace the latest query. Map failure preserves the store list/details and navigation fallback, offers retry and hides actions disallowed by the current session. Keyboard users can skip the shell navigation. Driver touch controls meet the approved 44px target on coarse pointers.

Verification boundaries: helper/hook tests cover persistence identity, snapshot rejection, search responses/generations and dirty navigation transitions. Rendered desktop/mobile inspection and real-device field testing are separate evidence.
