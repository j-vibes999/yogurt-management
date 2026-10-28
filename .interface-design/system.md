# Yogurt interface system

Authority: PRODUCT.md defines operations/business intent; DESIGN.md defines the established visual system. This memory records their implementation, not a competing style guide.

- Lao-first owner/admin, production and driver workflows; prioritize trustworthy money/stock and recovery under interrupted mobile connectivity.
- Reuse custom CSS and accessible React/Radix components. Root app reexports remain intentional.
- Noto Sans Lao; zero Lao letter-spacing; operational numbers use tabular numerals. Body 14–15px; coarse-pointer inputs at least 16px.
- Cream #F8F6EF, white surfaces, evergreen #173B31 navigation, green #20754F primary. Semantic status colors stay distinct from work-category colors.
- Refill/production green; stores/map blue; finance mango/dark brown; inventory purple. Reuse color-domain/color-metric tokens from professional.css/workspace-colors.css.
- Spacing rhythm 4/8/12/16/24/32/48px; controls radius8px, panels/dialogs12px. Normal panels use a restrained border; shadows belong to floating overlays.
- Forms keep visible labels, adjacent errors, visible focus, async announcements and honest saved/pending state. Preserve values on failure; never infer a financial commit from a network error.
- Drafts are scoped to the current account/store/snapshot. Pending commands retain their original UUID and body until the result is resolved.
- Existing dates/amounts must load before editing; stale edits return conflict. Completion shows the persisted receipt/result.
- Desktop controls at least40px; field/mobile actions at least44px; safe areas and keyboard-open layouts remain usable.
- Motion explains transitions (~150ms) and respects reduced motion. Preserve the owner's approved pausable login illustration.
- Authenticated shell includes a keyboard skip link to main. Actions must be visible only to roles allowed at their destination.

Current hardening scope (28 October2026): reliable drafts/errors/navigation, closing-date lookup/conflicts, map/search recovery and accessible feedback. No visual redesign.

Completeness pass (29 October2026): shared empty states and field help, 40/44px control sizing through shared variables, top-aligned form fields, sibling modal layering, permission-aware store/refill actions, preserved store handoff context and honest completed/empty states. Surface scope and verification limits are in completeness-surface.md.
