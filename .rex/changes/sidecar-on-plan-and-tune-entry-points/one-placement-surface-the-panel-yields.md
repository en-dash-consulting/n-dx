---
id: "a7bb7079-fcc5-4b3d-83c1-784fa7ab1f5f"
type: "task"
title: "One placement surface: the panel yields to the Sidecar's placement card"
slug: "one-placement-surface-the-panel-yields"
description: "SP2. When the drawer holds a placement card for the change being placed (Place lens, #946), S7's candidate panel collapses to one line, \"Placing with Sidecar · decide in the drawer\", with \"Place by hand\". The card's selected row lights its block on the spec map and picking a lit block selects that row on the card (shared placement state, not two copies). \"Place by hand\" reopens the panel with the card's selection and edits; a card withdrawn after M1's 60 s timeout leaves the panel ready with what the card held. The card stays the Sidecar's write path (dry-run pinning, decidedBy); the panel's Place stays the operator's."
acceptanceCriteria:
  - "With a placement card in the drawer for the change being placed, the panel shows one line with Place by hand"
  - "Selecting a row on the card lights its block, and selecting a block selects the card's row"
  - "Place by hand reopens the panel with the card's selection and edits"
  - "A withdrawn card leaves the panel open with its selection"
priority: "medium"
source: "ndx-capture"
---
