---
id: "b6858f4b-6c10-4faf-9220-af6607332184"
type: "change"
title: "Phase 2 PR 3: ndx work honours run settings saved on a task"
slug: "phase-2-pr-3-ndx-work-honours-run"
intent: "Prepare task phase 2, PR 3 of 4 (design §6, TP7, TP8). hench resolves settings per task after selection with precedence CLI flag > task run > hench.* > llm.* > default, so loops use each task's saved settings unless a flag is passed; run records carry the tier and model source actually used; --no-review and --no-skip-test-gate turn a saved setting off for one run; --resolve reports the saved block and each saved setting's fallback. This is the CLI behaviour change."
plannedRelease: "0.9.0"
priority: "high"
tags:
  - "task-prep"
  - "0.9.0"
---

Migration suggestion (text claude-opus-5-5, not accepted): place on "ndx work Model Resolution, Display, and Vendor-Change Reset" (3d1dfc17-ba48-4fb7-8b2e-392593740605).
