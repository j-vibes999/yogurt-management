# Native macOS operations surface

Mode: Operate. Purpose: the owner/admin uses the Mac throughout daily store servicing, production, inventory and money workflows. SwiftUI makes navigation and input native while retaining the tested business backend. The owner selected this architecture explicitly on 29 October 2026.

Authority: PRODUCT.md, DESIGN.md and system.md. Preserve Lao-first product copy, Noto Sans Lao, evergreen navigation, opaque cream/white data surfaces and approved work-category colors. System window chrome and menus follow macOS conventions. No WebView or Chromium UI.

Hierarchy: existing four sidebar groups in a two-column NavigationSplitView; one primary task per workspace. Stores are the connecting object across map/refill/audit/payment. Use native tables, sheets, file panels, menus and keyboard/focus handling; dedicated three-stage restock and separate payment-only flows. Keep stale/loading/error/empty states explicit. User administration is not newly exposed.

Product rhythm: 14px-equivalent Lao body, compact 28px title, tabular financial values, 8/12/16/24/32 spacing, readable 40px primary controls and restrained borders. Native category tokens mirror DESIGN.md. Preserve business context and pending command UUID/body before changing a workspace or closing a form.

Performance: render native navigation immediately; load over URLSession asynchronously; keep last verified in-memory content visible with a refresh state. Refresh only relevant resources after confirmed writes. Never trade current money/stock validation for a stale cache. Inspect actual shipped arm64 app in one batched visual pass, fix material defects together, then confirm once.

Inventory workspace (1 November 2026): use the bounded workspace option with native Table owning vertical scrolling; let the table fill the remaining window height. Keep search, category and ordering in one control row, and counted stock-status segments beneath. Names/codes lead; quantities and costs align at the trailing edge; empty stock is labeled separately from low stock. A persistent selection action bar offers receive, adjust and edit/count; double-click and context menu are native shortcuts. The receive form preselects the chosen material. Preserve exact raw-material edit snapshots, current-read write gating and cached/stale notices. Other workspaces retain their existing scroll layout.
