---
id: "813bb882-4d3d-46b0-b304-45648fd38992"
type: "task"
title: "The run queue drops a queued task whose status is blocked or deferred"
slug: "the-run-queue-drops-a-queued-task"
summary: "A queued task that was temporarily blocked or deferred lost its place in the queue; only finished or removed work is taken off now."
description: "Review 4672392634 (P2): run.ts treats every TaskNotActionableError as final, but it also covers status blocked and deferred. Fix: final only for completed, cancelled and deleted statuses (TaskNotActionableError.status) and TaskNotFoundError."
acceptanceCriteria:
  - "A queued task with status blocked or deferred is passed over and kept"
  - "A completed, cancelled or deleted one is still dropped"
  - "An integration test uses a task whose status is blocked"
priority: "high"
source: "pr-review"
---
