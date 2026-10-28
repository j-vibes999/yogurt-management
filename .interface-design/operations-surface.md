# Operations surface

Target: src/components/operations-forms.tsx and /operations
Mode: Operate
Purpose: owner/admin records stock waste and an accurate daily cash/bank/expense closing.

Keep the current finance category, compact form grid, native labeled inputs, InlineFeedback and primary green action. Selecting a closing date loads the saved values before enabling edits. Mark creating versus editing, preserve input on failure, and require reloading an explicit conflict before resubmission. Saving must never replace unreviewed values with defaults. Success appears only after the persisted response is confirmed. Palette, typography, spacing and accessible dialog behavior follow DESIGN.md and system.md.
