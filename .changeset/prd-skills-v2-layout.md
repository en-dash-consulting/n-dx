---
"@n-dx/core": patch
---

`/ndx-capture`, `/ndx-plan`, `/ndx-reshape`, `/ndx-work` and
`/ndx-adversarial-review` now find the PRD layout first (`get_prd_status`
answers `"layout": "v2"` on a v2 tree) and branch on it, for Claude and Codex
alike. On a v2 tree they pass `type` to `add_item`, never `level`, and create
changes rather than epics or features; a capture left in the Inbox shows its
suggested placement from `place_change`; `/ndx-reshape` restructures with
`place_change`, `move_item` and `merge_items` and never asks `edit_item` for a
level change; the overlap checks and commit steps cover `.rex/changes/` and
`.rex/product/`, `state.yaml` files included. On a v1 tree every skill behaves
as before. `tests/e2e/skill-prd-layout.test.js` pins both branches.
