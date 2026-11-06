---
id: "65a40ad5-dfcd-4095-93bc-09e0c68e323c"
type: "task"
title: "A task reset to pending doesn't keep its change In progress"
slug: "a-task-reset-to-pending-doesn-t-keep"
description: "Stack review round 2 finding on #963 at packages/web/src/server/routes-rex/product.ts:221 (review comment 4494323973).\n\n**Should fix: a task reset to pending after a failed run still marks its change In progress**\n\n`isStarted` is true for any node with `startedAt`, and rex never clears it. `computeTimestampUpdates` (rex `core/timestamps.ts:71`) sets it only when unset, and leaving `in_progress` leaves it alone. Hench's failed-run reset moves the task back to `pending` through that same path. So after one failed `ndx work` attempt, the change shows In progress on the strip, the Changes stage chips and the product overlays until the task completes or is cancelled. The same happens to a task deferred or blocked after it started.\n\nFix: judge tasks and subtasks by status (`in_progress`, `failing`) rather than by `startedAt`. Add a test with a `pending` task that carries `startedAt` and expect `proposed`/`ready`."
acceptanceCriteria:
  - "routes-rex/product.ts judges a change's tasks and subtasks by status (in_progress, failing) when deciding In progress, not by startedAt, which rex never clears"
  - "A test with a pending task carrying startedAt expects its change to read proposed or ready, not in-progress"
---
