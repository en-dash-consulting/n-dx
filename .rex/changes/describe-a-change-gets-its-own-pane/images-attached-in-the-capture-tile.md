---
id: "c7f8036b-a254-4a7a-ba44-7bea5146ae0d"
type: "task"
title: "Images attached in the capture tile are dropped from a modal capture and uploaded onto the next change"
slug: "images-attached-in-the-capture-tile"
summary: "A screenshot attached in the Plan capture panel is silently left off when the change is added from the expanded view, and then gets attached to whatever the person captures next. This keeps attachments with the change they were meant for."
description: "Verdict: must-fix (severity high, regression), from the adversarial review of feat/capture-pane-modal (214da2053).\n\nTrigger (v2, model accepts images): paste or '+' a screenshot into the tile → click More → the modal shows the text but no image → Preview, Add → the change is created with no attachment upload, silently. The shared draft clears, but the tile still holds the image, so the next tile capture uploads it onto an unrelated change. Before this branch the same SmartAddInput stayed mounted across More/Less, so images survived. The only image test attaches inside the modal.\n\nEvidence: packages/web/src/viewer/views/analysis.ts:120-127 shares only draft.text; components/prd-tree/smart-add-input.ts:313 keeps images per instance, :591 clears only that instance.\n\nFix A (recommended, ~30 lines, low risk): lift images/setImages into CaptureDraftProvider beside the text, as optional images/onImagesChange props mirroring draft; clear them on any successful capture. Fix B (placeholder tile while the modal is open) still needs A."
acceptanceCriteria:
  - "An image attached in the capture tile appears in the modal after clicking More"
  - "Adding from the modal uploads the image attached in the tile onto the new change"
  - "After a successful capture from either the tile or the modal, neither one still holds the attached images"
  - "A test attaches an image in the tile, opens the modal, adds the change, and asserts the upload and that the tile is cleared"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
