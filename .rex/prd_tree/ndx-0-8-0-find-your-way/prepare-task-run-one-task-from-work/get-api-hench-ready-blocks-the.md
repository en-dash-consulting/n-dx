---
id: "f8afecbd-6216-4d72-98b3-b8d9a26836a4"
level: "task"
title: "GET /api/hench/ready blocks the dashboard's event loop for seconds per refresh"
status: "pending"
priority: "high"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:high"
  - "web-server"
  - "performance"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "GET /api/hench/ready computes its order with a single selection pass, not one findNextTask call per row."
  - "A test asserts the returned order equals the findNextTask-repeated order on a fixture with dependencies and mixed priorities."
  - "A timing test (or benchmark assertion with generous bounds) on a generated 2,000-item tree completes well under one second."
description: "Verdict: must-fix (introduced; hit on every Ready to run refresh).\n\nScenario: packages/web/src/server/routes-hench-prep.ts:274-292 calls findNextTask once per row, and each call rebuilds the comparator (requirementsScore for every item, buildDependentCounts over the whole tree; rex next-task.ts:205-219), synchronously on the request thread. Measured on this repo's PRD (1,849 items, 28 actionable): the loop takes 4.7 s; one findActionableTasks(items, completed, 50, {excludeIds}) call takes 170 ms and returns the identical order. At 4× the PRD it ran over 2 minutes. ready-to-run.ts:87 refetches on every hench-runs live event, so the dashboard freezes for seconds each time a run changes.\n\nFix (recommended): replace the loop with one findActionableTasks(doc.items, completedIds, limit, { excludeIds }) call (export it through packages/web/src/server/rex-gateway.ts if needed). Keep the row shape, resume/liveRun flags and claimed-task exclusion unchanged."
lastModified: "2026-10-02T07:47:23.848Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
