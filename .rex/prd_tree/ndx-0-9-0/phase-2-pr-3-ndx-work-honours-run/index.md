---
id: "b6858f4b-6c10-4faf-9220-af6607332184"
level: "feature"
title: "Phase 2 PR 3: ndx work honours run settings saved on a task"
status: "completed"
priority: "high"
tags:
  - "task-prep"
  - "0.9.0"
startedAt: "2026-10-07T20:41:07.038Z"
completedAt: "2026-10-07T20:41:07.038Z"
endedAt: "2026-10-07T20:41:07.038Z"
acceptanceCriteria: []
description: "Prepare task phase 2, PR 3 of 4 (design §6, TP7, TP8). hench resolves settings per task after selection with precedence CLI flag > task run > hench.* > llm.* > default, so loops use each task's saved settings unless a flag is passed; run records carry the tier and model source actually used; --no-review and --no-skip-test-gate turn a saved setting off for one run; --resolve reports the saved block and each saved setting's fallback. This is the CLI behaviour change."
lastModified: "2026-10-07T20:41:07.564Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Docs and changesets for PR 3: how ndx work applies saved run settings](./docs-and-changesets-for-pr-3-how-ndx.md) | completed |
| [hench: --no-review and --no-skip-test-gate turn a saved setting off for one run](./hench-no-review-and-no-skip-test-gate.md) | completed |
| [hench --resolve: report the saved block, each saved setting's fallback, and keep saved settings out of the printed command](./hench-resolve-report-the-saved-block.md) | completed |
| [hench: resolve run settings per task after selection, honour task.run with CLI > task > hench > llm > default, record the tier and model source actually used](./hench-resolve-run-settings-per-task.md) | completed |
