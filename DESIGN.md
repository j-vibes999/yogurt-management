# Yogurt Super Web — Design Direction

## Design objective
Refine the existing Yogurt identity into calm, credible, professional operations software. Preserve familiarity and the existing green/cream character while removing visual noise and inconsistent styling accumulated through iterative patches.

The product should feel warm enough to belong to a yogurt brand, but disciplined enough to be trusted for inventory, money, operations, and reporting.

## Visual personality
- Calm
- Operational
- Fresh
- Warm
- Clear
- Trustworthy
- Human, not playful
- Modern, not trend-driven

Avoid generic AI-dashboard aesthetics, neon/glow, excessive gradients, glass panels, decorative blobs, random pastel cards, card-inside-card layouts, oversized marketing-style hero treatments, and animation without informational purpose.

## Canonical visual system
### Core palette
- App background / cream: `#F8F6EF`
- Surface: `#FFFFFF`
- Soft surface: `#F4F7F2`
- Deep surface: `#E7EEE6`
- Sidebar / evergreen: `#173B31`
- Primary / fresh green: `#20754F`
- Primary hover: `#195D40`
- Primary soft / mint: `#EAF5ED`
- Text: `#21372D`
- Muted text: `#617166`
- Border: `#DCE4D9`
- Strong border: `#B7C6B8`
- Brand accent / mango: `#E6AA50` (dark text only)
- Accent / warning soft: `#FFF1D5`
- Success: `#2A754B`, soft: `#EAF5ED`
- Warning: `#8A5B17`, soft: `#FFF1D5`
- Danger: `#B6444E`, soft: `#FBECEF`
- Info: `#326D96`, soft: `#EDF5FA`

Shared base tokens live in `src/app/professional.css`. Category modifiers live in `src/app/workspace-colors.css`, and `src/app/dashboard.css` applies the matching dashboard categories. Older component aliases resolve to the base tokens. The root layout loads globals, professional, then workspace colors; the dashboard imports its own stylesheet. The cup and leaf SVG is reused on login and navigation.

Color is semantic. Do not assign dashboard tiles decorative color families unless the color communicates status, category, or action meaning.

### Approved category colors
The owner approved these category colors for clearer grouping across the application. Preserve them during visual refinement.

| Work category | Text/ink | Accent | Soft background |
|---|---|---|---|
| Refill and production | `#20754F` | `#20754F` | `#EAF5ED` |
| Stores, fridges, map, and operations | `#326D96` | `#326D96` | `#EDF5FA` |
| Settlements, expenses, and financial reports | `#8A5B17` | `#E6AA50` | `#FFF1D5` |
| Inventory and raw materials | `#75509E` | `#9472BF` | `#F5EFFF` |

Reuse the existing `color-domain-*`, `color-metric-*`, and `dashboard-category-*` patterns. Category colors group headings, summary values, and work panels. Keep ordinary data rows and inputs on readable white surfaces; shared primary actions remain green. Panels may use the category of the work they represent.

Category and status are separate meanings. A finance panel's mango tint does not make every item a warning; a green production panel does not imply completion. Status must also have a visible label and an icon where helpful. Dark ink is used over the mango accent, and all text/background combinations must meet the contrast requirement below.

## Typography
Use `Noto Sans Lao` as the canonical product typeface because Lao readability and consistency across Lao/Latin are more important than decorative font personality.

Hierarchy:
- H1: 26–32px, 700 weight, 1.35–1.4 line-height
- H2: 19–20px, 700 weight
- H3: 16px, 650 weight
- Body: 14–15px, 1.55–1.65 line-height
- Label/metadata: 12–13px, 400–650 weight
- Navigation: 14px, 500 weight; active 700
- Operational numbers: tabular numerals where supported
- Text inputs on coarse pointers: at least 16px

Lao text uses zero letter-spacing. Hierarchy comes from size, spacing, grouping, and contrast. Avoid applying bold weight to all text.

## Spacing
Canonical spacing rhythm:
- 4px
- 8px
- 12px
- 16px
- 24px
- 32px
- 48px

Prefer whitespace and section grouping over extra borders or nested cards.

## Radius
Canonical radius scale:
- 6px: badges/status chips
- 8px: controls/buttons/compact surfaces
- 10px: tables/list cards
- 12px: standard panels/dialog structural surfaces

Avoid pill shapes except for true tags/statuses. Avoid arbitrary 18–24px radii in operational UI.

## Elevation
Normal surfaces use border + spacing, not shadow.
- Level 0: page/background
- Level 1: standard surface; border, no shadow
- Level 2: floating/transient elements only; dialog/menu/popover may use restrained shadow

## Layout and hierarchy
- Every page has one clear title and one clear primary task.
- Group related content into sections before wrapping every block in a card.
- Prefer 1–2 strong visual hierarchy levels over many competing panels.
- Operational data is aligned for fast scanning.
- Financial values are clear but not loud unless action is required.
- Dense operational screens should remain readable rather than artificially spacious.

## Navigation
- Keep existing information architecture unless a demonstrated UX issue requires change.
- Sidebar uses evergreen with a mint active surface and dark text. The navigation scrolls when content exceeds the available height; do not shrink all labels or clip routes to force a fit.
- Group headings remain visually quiet but useful for scanning.
- Active state uses background + text/icon emphasis, not gradients or thick accent rails.
- Icons support labels and never replace them.

## Dashboard
The dashboard is a command surface, not a marketing landing page.

Priority order:
1. What needs attention now
2. Today’s key operational counts/amounts
3. Active work queues
4. Inventory/financial exceptions
5. Secondary navigation

Hero treatment must remain compact. Decorative yogurt artwork may remain only if visually quiet and secondary to operational content.

## Tables
Tables are first-class product surfaces.
- Header height approximately 40px
- Compact but readable row density
- Numeric values use tabular alignment where appropriate
- Sorting/filter/action affordances are obvious
- Borders are restrained
- No nested-card treatment around every table
- Mobile views may transform into task-oriented rows/cards when a table no longer fits

## Forms
- One visible label per field
- Help/error text is adjacent to its field
- Required/invalid state does not rely only on color
- Controls use 8px radius and minimum ~40px height on desktop
- Touch-critical mobile controls target at least 44px
- Primary/destructive actions are clearly distinct
- Visible keyboard focus is mandatory

## Status system
Use one semantic language across the product:
- Neutral
- Info
- Success
- Warning
- Critical

Status colors and wording must have the same meaning everywhere. Refill lifecycle: waiting = amber, preparing = blue, delivering/completed = green. Keep visible labels and relevant icons; color alone is insufficient.

## Dialogs and overlays
- Use dialogs for focused tasks, confirmations, or short forms
- Preserve Radix accessibility behavior
- Destructive confirmations state consequences plainly
- Dialogs may use restrained elevation because they float above the app

## Mobile
Mobile is task-first.
- Key actions are reachable without precision tapping
- Touch targets are comfortable
- Wide desktop layouts are not copied directly
- Bottom navigation/action areas respect safe-area insets
- Forms remain usable with the software keyboard open
- Driver/refill flows receive dedicated mobile treatment

## Motion
Motion explains state or spatial transition.
- Typical interaction duration: ~150ms
- Use subtle transitions for hover/focus, dialog/menu entry, loading-to-content, and completion feedback
- Respect `prefers-reduced-motion`
- No continuous decorative animation in operational pages. The owner approved a gently animated SVG illustration on Login (2 October 2026); provide a visible pause/resume control and disable motion under `prefers-reduced-motion`.

## Accessibility
- Preserve/improve semantic HTML
- Visible focus states
- Appropriate ARIA only when native semantics are insufficient
- Text contrast target >= 4.5:1 for normal text
- State is never conveyed by color alone
- Reduced-motion behavior is mandatory

## Implementation rules
- Existing business logic, routes, permissions, calculations, and data behavior remain unchanged during visual refinement unless explicitly approved.
- Do not add versioned CSS classes such as `*-v44` for new work.
- New styling moves toward semantic components and tokens.
- Existing versioned classes may remain temporarily for regression safety and are migrated incrementally.
- Do not add `!important` except as a temporary compatibility bridge against legacy specificity; remove it during consolidation.
- Prefer reusable primitives/tokens over page-specific one-off values.
- No global visual effect may be introduced only because it is trendy.

## Skill authority
1. `PRODUCT.md` — product truth and business intent
2. `DESIGN.md` — visual authority
3. Interface Design — consistent product layout, hierarchy, components, and design memory in `.interface-design/system.md`
4. Impeccable — focused color, typography, layout, clarity, and resilience passes; mode belongs in the matching surface brief
5. Product Design and UX — task flows, role handoffs, recovery, and observable completion
6. Frontend Design — interaction, responsive, state, accessibility review
7. Emil Design Engineering — component polish and restrained interaction
8. Vercel Web Interface Guidelines — final interface QA using the current upstream checklist
9. UI UX Pro Max — targeted reference lookup; preserve Lao typography and verify implementation guidance against the project's actual framework version
10. Addy Osmani Agent Skills — engineering quality, testing, architecture, debugging, delivery

Load the skills needed for the task. Existing product decisions, the approved category palette, Noto Sans Lao, and the custom CSS/Radix implementation take precedence over generic style defaults. A refinement uses the established direction; a new skill installation is not a request to replace it. Keep `.interface-design/system.md` and surface briefs aligned with this document rather than creating competing design systems.

## Review test
Before accepting a visual change, ask:
- Does it make priority clearer?
- Does it reduce cognitive load?
- Does it remain familiar to current users?
- Does it improve consistency across Yogurt?
- Does it work in Lao and on mobile?
- Is decoration carrying information or merely creating noise?
- Would this look credible as production business software rather than an AI-generated concept?
