---
id: "da23320c-8b2f-4197-8208-c993f13dea40"
type: "task"
title: "Closing the capture modal drops images attached in it"
slug: "closing-the-capture-modal-drops-images"
summary: "Pressing Escape or clicking outside the expanded capture view throws away any screenshots attached there. This keeps them, like the text already is."
description: "Verdict: should-fix (severity medium), from the adversarial review of feat/capture-pane-modal.\n\nTrigger: attach an image in the modal → Esc (or an accidental backdrop click) → reopen: the image is gone. FullScreenTile unmounts its SmartAddInput; only text survives through CaptureDraftProvider. The old More/Less toggle kept it.\n\nFix: covered by sharing images through CaptureDraftProvider (sibling task 'Images attached in the capture tile are dropped…'); losing an unsent preview on close is acceptable."
acceptanceCriteria:
  - "An image attached in the capture modal is still attached after the modal is closed and reopened"
  - "An image attached in the modal is shown in the capture tile after the modal closes"
  - "A test covers attach, close, reopen"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
