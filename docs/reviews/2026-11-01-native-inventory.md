# Native inventory workspace — 1 November 2026

The owner requested a clearer, easier inventory workspace and a table that uses the available window height. The previous table had a 340-point minimum inside a page-level ScrollView, leaving much of a tall window unused.

## Delivered behavior

- Inventory opts into a bounded workspace viewport. The native Table owns scrolling and fills the remaining space; the title, filters and selected-item commands stay outside it. Other pages keep the existing scroll layout.
- Search covers material name, code and unit. Category and stock status are independent filters; stock-status segments display matching counts. Ordering can prioritize items needing replenishment or sort by name.
- Material name/code lead the row. Quantities and costs align on the trailing edge. Empty, low and sufficient stock have distinct words and symbols; selected rows use the platform foreground for readable contrast.
- Selecting a row exposes receive, adjust and edit/count actions. Double-click/context menu provide native alternatives. Receive preselects the chosen material; edit/count continues using the exact server snapshot. Cached/stale data cannot launch a write editor.
- No backend calculations, permissions, database schema or transaction endpoints changed.

## Verification and limits

Swift's full suite passed 44 tests, including exact stock-threshold boundaries, combined search/category/status filters, attention ordering and retained six-decimal values. Release packaging, signature verification and installed-binary equality passed. A read-only review found no actionable source defect in selection, receive prefilling or shared-layout isolation.

The installed app was inspected with the real nine-material dataset, selected rows, stock-filter empty state, restored results and window resizing. The inspection exposed viewport overflow and low-contrast selection; both were corrected and the rebuilt installed app was visually confirmed. Automated UI interaction was interrupted by concurrent user activity, so receive/adjust/edit submission and the minimum supported window were not fully exercised manually. No business records were created or changed during this verification. The updated app remains available at its original installation path.

Native Table sizing follows [Apple's Table behavior](https://developer.apple.com/documentation/swiftui/table). The Lao-first palette, typography and workflow constraints remain governed by PRODUCT.md, DESIGN.md and .interface-design/native-macos-surface.md.
