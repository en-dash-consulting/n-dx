---
id: "7d634075-c0a6-4a7b-ba38-c37f2b9e1b4d"
level: "task"
title: "ndx status: show a log of the last work cycle (completed / failed / skipped)"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "status"
  - "work-tracking"
source: "ndx-capture"
startedAt: "2026-09-11T23:22:18.820Z"
completedAt: "2026-09-11T23:31:04.928Z"
endedAt: "2026-09-11T23:31:04.928Z"
resolutionType: "code-change"
resolutionDetail: "rex status (and ndx status) now renders a \"Last work cycle\" section — completed / failed (with reason labels) / skipped / running plus counts — derived from the run records hench already persists in .hench/runs/ (timing-based cycle clustering; no new state, history persists across sessions). 12 unit tests; full rex suite green; verified live against 147 real runs."
acceptanceCriteria:
  - "ndx status displays current PRD state plus a summary of the most recent work cycle — which tasks completed, which failed, and which were skipped"
  - "Work-cycle history persists across sessions"
description: "ndx status should include a simple log of what ran in the last work cycle — what completed, what failed, what was skipped. Today the command shows PRD state only; the operator has to dig through .hench/runs/ JSON or .run-logs/ to reconstruct what the last ndx work / --auto / --loop invocation actually did. Hench already persists run records in .hench/runs/ (status, taskId, taskTitle, startedAt, testGate outcome), so the status command can aggregate the most recent cycle from those records rather than introducing new state. Skipped items (e.g. tasks the loop excluded or auto-cancelled) should be surfaced alongside completions and failures."
lastModified: "2026-09-11T23:31:04.957Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
