---
id: "d80a00cd-e1f4-472b-8be8-ca49e3086a4a"
type: "change"
title: "Sequential session batching strategy (tasksPerSession)"
slug: "sequential-session-batching-strategy"
intent: "Implement the batch strategy as the vendor-neutral alternative to forking: execute up to hench.tasksPerSession tasks in one CLI session by feeding task N+1's brief as the next user turn, with explicit task-boundary dividers to limit cross-task context pollution. Start a fresh session on failure, on context exhaustion, or every tasksPerSession tasks."
acceptanceCriteria:
  - "The batch strategy executes up to tasksPerSession tasks in one session with explicit task-boundary dividers"
  - "A failed or context-exhausted task starts a fresh session for the next task"
  - "Task briefs after the first are delivered as follow-up turns rather than new spawns"
  - "Run records remain one-per-task with correct token attribution per task"
touches:
  - "00d910d1-dc49-488d-bd6f-3d26911abc79"
priority: "medium"
tags:
  - "hench"
  - "sessions"
source: "ndx-work"
---
