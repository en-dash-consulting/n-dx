# Viewer styling guide

Rules for every stylesheet in this directory. Colour tokens and their contrast
ratios are in [PALETTE.md](PALETTE.md).

## Emphasis is a background tone, never a left stripe

To make a card, row or list item stand out (status, selection, "modified",
"needs attention", a hovered match), change its **background**. Do not use a
coloured left edge: no `border-left: 3px solid <colour>`, no
`border-left-color`, no `box-shadow: inset 3px 0 0 <colour>`. On a rounded
element a thick left border curves with the corner and reads as a stray
bracket, and the stripe repeats colour the item's badge or label already gives.

- **Neutral emphasis** (raised, hovered, selected without a status):
  `color-mix(in srgb, var(--text) 4%, transparent)`, about 7% on hover. Mixing
  in the text colour lightens the item on the dark theme and darkens it on the
  light one, so one rule serves both.
- **Status emphasis** (failed, warning, passed, pending): a tint of the status
  token, `color-mix(in srgb, var(--red) 8%, var(--bg-surface))`, roughly 5–14%.
  Mix into the surface the element normally sits on (`--bg-surface` for a card,
  `--bg` for a row on the page) so the item stays opaque.
- **The colour that carries meaning goes on a badge or label**, not on an edge.
  An item whose status matters names it in text (`NEXT STEP`, `HIGH`,
  `FAILED`), so the tint is never the only signal.

Left borders are still fine where they are **structure** rather than emphasis:
a 1px divider on a panel or split button, a tree's indent rail, or a dashed
marker for a ghost or proposed row. `tests/unit/viewer/no-left-stripe-emphasis.test.ts`
fails any other left stripe.
