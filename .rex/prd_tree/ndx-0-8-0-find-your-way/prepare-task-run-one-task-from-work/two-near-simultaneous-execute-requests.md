---
id: "29f1866d-e6c7-44a6-9243-5767ead10d27"
level: "task"
title: "Two near-simultaneous execute requests for the same task both spawn a run"
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
  - "Two concurrent POST /api/hench/execute for the same task in the same workspace spawn exactly one run; the other answers 409 (test with a delayed claims/holder check)."
  - "Every early-return path (400, 409, 412, spawn failure) releases the reservation; a test retries after each."
description: "Verdict: must-fix (widened by this feature; in-progress resume makes it reachable, and hench #472 means nothing downstream stops a second run in the same worktree).\n\nScenario: two tabs, or Start now on a Ready row while the modal executes the same task. handleExecute checks activeExecutions.has(taskId) at packages/web/src/server/routes-hench.ts:1902, then awaits claims (:1915), findHoldingRun (:1946) and writeContextNotesFile (:1975), and only sets the entry at :2043. Both requests pass has() and both spawn `ndx work` on one task in one worktree; the second set() overwrites the first entry (the first run can no longer be stopped from the dashboard) and the first run's completion deletes the second's entry.\n\nFix (recommended): reserve the task synchronously right after has() (a pending placeholder entry or a pending set keyed by workspace+task) and release it in try/finally on every early return; the second request answers 409 'already starting'."
lastModified: "2026-10-02T07:47:30.185Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
