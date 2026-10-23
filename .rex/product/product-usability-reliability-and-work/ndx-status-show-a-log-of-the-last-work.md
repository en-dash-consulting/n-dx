---
id: "7d634075-c0a6-4a7b-ba38-c37f2b9e1b4d"
type: "capability"
title: "ndx status: show a log of the last work cycle (completed / failed / skipped)"
slug: "ndx-status-show-a-log-of-the-last-work"
statement: "`ndx status` shows the current PRD state together with a summary of the most recent work cycle, listing which tasks completed, failed or were skipped."
criteria: [{"id":"c1","text":"When the operator runs `ndx status`, the status command shall display the current PRD state."},{"id":"c2","text":"When the operator runs `ndx status`, the status command shall display a summary of the most recent work cycle that lists which tasks completed, which failed and which were skipped."},{"id":"c3","text":"The status command shall build the work-cycle summary from the hench run records in `.hench/runs/`."},{"id":"c4","text":"The status command shall list tasks that the work loop excluded or auto-cancelled as skipped."},{"id":"c5","text":"The status command shall keep work-cycle history available across sessions."}]
requirements: [{"id":"7d634075-c0a6-4a7b-ba38-c37f2b9e1b4d:c2","title":"When the operator runs `ndx status`, the status command shall display a summary of the most recent work cycle that lists which tasks completed, which failed and which were skipped","description":"Linked to: packages/rex/tests/unit/cli/commands/status-work-cycle.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When the operator runs `ndx status`, the status command shall display a summary of the most recent work cycle that lists which tasks completed, which failed and which were skipped."]},{"id":"7d634075-c0a6-4a7b-ba38-c37f2b9e1b4d:c3","title":"The status command shall build the work-cycle summary from the hench run records in `.hench/runs/`","description":"Linked to: packages/rex/tests/unit/cli/commands/status-work-cycle.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["The status command shall build the work-cycle summary from the hench run records in `.hench/runs/`."]},{"id":"7d634075-c0a6-4a7b-ba38-c37f2b9e1b4d:c4","title":"The status command shall list tasks that the work loop excluded or auto-cancelled as skipped","description":"Linked to: packages/rex/tests/unit/cli/commands/status-work-cycle.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["The status command shall list tasks that the work loop excluded or auto-cancelled as skipped."]}]
tags:
  - "cli"
  - "status"
  - "work-tracking"
source: "ndx-capture"
priority: "medium"
---

ndx status should include a simple log of what ran in the last work cycle — what completed, what failed, what was skipped. Today the command shows PRD state only; the operator has to dig through .hench/runs/ JSON or .run-logs/ to reconstruct what the last ndx work / --auto / --loop invocation actually did. Hench already persists run records in .hench/runs/ (status, taskId, taskTitle, startedAt, testGate outcome), so the status command can aggregate the most recent cycle from those records rather than introducing new state. Skipped items (e.g. tasks the loop excluded or auto-cancelled) should be surfaced alongside completions and failures.
