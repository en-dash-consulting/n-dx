---
id: "ead2b95c-a42d-49ab-aae7-ee9dd2add24d"
level: "task"
title: "The Live idle card and Workspaces cards never offer Resume for an in-progress task"
status: "pending"
priority: "low"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:low"
  - "web-viewer"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The Live idle card and Workspaces cards show Resume for an in-progress task with no live run, blockers for a blocked task and a Live link while a run is live; tests cover each."
description: "Verdict: should-fix (criterion of task e403f6ec unmet on two surfaces).\n\nScenario: views/live.ts:475 and views/workspaces.ts:528 use StartTaskButton directly instead of TaskStartControl, so an in-progress next task with no live run shows 'Start working', not Resume, and these cards skip the shared startOffer rule (blocked tasks, live-run link). Fix (recommended): route both through TaskStartControl (passing workspace) so every surface shares one offer rule."
lastModified: "2026-10-02T07:47:47.693Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
