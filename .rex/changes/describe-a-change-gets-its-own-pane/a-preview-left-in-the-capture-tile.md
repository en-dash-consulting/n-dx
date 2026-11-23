---
id: "a677f672-d7ac-46a3-bc05-64fa65aab7ee"
type: "task"
title: "A preview left in the capture tile survives a modal capture, so Add creates a duplicate change"
slug: "a-preview-left-in-the-capture-tile"
summary: "If someone previews a change in the Plan capture panel and then adds it from the expanded view, the panel's own Add button still works and creates the same change a second time. This clears the panel once the change is added."
description: "Verdict: must-fix (severity high), from the adversarial review of feat/capture-pane-modal (214da2053).\n\nTrigger: type in the tile → Preview (tile grows with the card and its Add button) → More → Preview → Add in the modal → close. The tile still shows its preview and Add over an empty textarea; Add replays previewedRef to /api/rex/smart-add-accept and creates a second Inbox change (carrying any tile images, see sibling task).\n\nEvidence: each SmartAddInput keeps its own state/changes/previewedRef (components/prd-tree/smart-add-input.ts:300, :595); only the text is shared through CaptureDraftProvider, so the modal's accept resets nothing in the tile. No test covers it.\n\nFix (recommended, small, low risk): a capture counter in CaptureDraftProvider incremented by every successful accept; each SmartAddInput resets state, changes, choices, previewedRef and images when it changes. Alternative: lift preview state into the provider (larger)."
acceptanceCriteria:
  - "After a change is added from the modal, the capture tile shows no preview and no Add button"
  - "After a change is added from the tile, a modal opened afterwards shows no stale preview"
  - "A test previews in the tile, adds from the modal, and asserts the tile's Add is gone and only one accept request was sent"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
