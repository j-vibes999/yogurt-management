# Interface completeness

Targets: src/app and src/components, including directories, create/edit forms, production, operations, reports, maps and driver work.
Mode: Operate
Purpose: every role can identify the current state and its permitted next action, with a complete and usable layout on office and field screens.

Preserve PRODUCT.md, DESIGN.md, Lao copy and Noto Sans Lao, existing category/status colors, custom CSS/Radix, calculations and backend permissions. This is a correction of incomplete states and layout, not a replacement visual direction.

Use the shared EmptyState with separated icon, title, explanation and an applicable recovery action. Distinguish completed work from no search matches. Keep contextual store selection across refill handoffs. Render only permitted actions and use raw nullable values in edit fields rather than display placeholders. Refresh shared master-data options after successful writes.

Fields align from the top without stretching beside help text. Shared controls use the established 40px desktop and 44px mobile/coarse-pointer minimum. Search wrappers own their visible border. Modal overlay and content are sibling layers with content above the overlay, contained scrolling and focus return. ResponsiveDisclosure opens desktop work that would otherwise be hidden by a closed native details element.

Verification: route coverage and screenshots at 1280px and 390px; intermediate checks at 768px; role-specific server renders and selected interactive recovery paths on disposable local clones. Viewport testing does not certify physical-device gestures, software keyboards or full assistive-technology conformance.
