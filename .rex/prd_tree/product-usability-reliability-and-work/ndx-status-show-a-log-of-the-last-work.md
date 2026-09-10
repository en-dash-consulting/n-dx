---
id: "7d634075-c0a6-4a7b-ba38-c37f2b9e1b4d"
level: "task"
title: "ndx status: show a log of the last work cycle (completed / failed / skipped)"
status: "pending"
priority: "medium"
tags:
  - "cli"
  - "status"
  - "work-tracking"
source: "ndx-capture"
acceptanceCriteria:
  - "ndx status displays current PRD state plus a summary of the most recent work cycle — which tasks completed, which failed, and which were skipped"
  - "Work-cycle history persists across sessions"
description: "ndx status should include a simple log of what ran in the last work cycle — what completed, what failed, what was skipped. Today the command shows PRD state only; the operator has to dig through .hench/runs/ JSON or .run-logs/ to reconstruct what the last ndx work / --auto / --loop invocation actually did. Hench already persists run records in .hench/runs/ (status, taskId, taskTitle, startedAt, testGate outcome), so the status command can aggregate the most recent cycle from those records rather than introducing new state. Skipped items (e.g. tasks the loop excluded or auto-cancelled) should be surfaced alongside completions and failures."
lastModified: "2026-09-10T01:51:46.641Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
