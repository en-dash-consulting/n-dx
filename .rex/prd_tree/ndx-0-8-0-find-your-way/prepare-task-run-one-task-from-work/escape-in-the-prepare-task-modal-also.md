---
id: "6e90110f-b265-433a-a963-8ed8be0a00b5"
level: "task"
title: "Escape in the Prepare task modal also closes the PRD detail panel underneath"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web-viewer"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Escape with the modal open over the PRD detail panel closes only the modal and returns focus to the Start control; a test covers it."
  - "Escape with no modal still closes the detail panel."
description: "Verdict: must-fix (introduced; the PRD panel is a main entry point and focus-return breaks).\n\nScenario: in the PRD task detail panel press Start, then Escape. The modal's document keydown listener (components/prepare-task-modal.ts:87-95) calls stopPropagation, which does not stop DetailPanel's own document listener (components/detail-panel.ts:20-27). Both close; the modal's focus-return target is gone.\n\nFix (recommended): register the modal's listener in the capture phase and call stopImmediatePropagation plus preventDefault; have DetailPanel ignore events with defaultPrevented."
lastModified: "2026-10-02T07:47:33.359Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
