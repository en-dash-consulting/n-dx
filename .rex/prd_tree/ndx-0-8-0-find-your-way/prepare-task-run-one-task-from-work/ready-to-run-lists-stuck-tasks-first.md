---
id: "31ffacbc-bbc7-4dc0-8811-8821c1460f9f"
level: "task"
title: "Ready to run lists stuck tasks first, though ndx work --auto skips them"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "ndx-adversarial-review"
  - "severity:medium"
  - "web-server"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A task hench considers stuck is excluded from /api/hench/ready (or flagged stuck and ordered as --auto would), and its dependents are ordered as --auto would; a test covers it."
  - "The ordering test uses a dependency chain and equal priorities so a plain priority sort would fail it."
description: "Verdict: should-fix.\n\nScenario: a task with repeated hard failures is ranked first by the comparator, but autoselect excludes stuck tasks (run.ts:2117-2125, loadStuckTaskIds(henchDir, maxFailedAttempts)) and treats them as completed for dependents. GET /api/hench/ready (routes-hench-prep.ts:272-276) excludes neither, so the list's order is not what --auto picks. The order test (:370) uses three tasks with distinct priorities, so it cannot tell findNextTask order from a priority sort.\n\nFix (recommended): compute the stuck set the same way (read .hench/runs for consecutive hard failures per task, as hench does; or expose a helper) and fold it into the exclusion and completed sets; mark such rows `stuck: true` if shown at all."
lastModified: "2026-10-02T07:47:38.134Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
