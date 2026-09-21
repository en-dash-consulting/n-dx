---
id: "89bd6c5d-093b-480d-91ba-965289768925"
level: "task"
title: "Record task start and end timestamps from hench runs and status transitions"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "prd"
  - "timing"
source: "smart-add"
startedAt: "2026-04-23T16:03:02.619Z"
completedAt: "2026-04-23T16:16:21.009Z"
resolutionType: "code-change"
resolutionDetail: "Added startedAt/endedAt/activeIntervals timing fields to PRDItem; extended computeTimestampUpdates to stamp them on every status transition; shipped getTaskDuration helper with 14 unit tests."
acceptanceCriteria:
  - "`.rex/prd.json` items gain `startedAt`, `endedAt`, and `activeIntervals: [{start, end}]` fields, backfilled as optional so existing PRDs load unchanged"
  - "Starting a task that is already in-progress does not overwrite the original `startedAt`; re-opening a completed task appends a new interval"
  - "A helper `getTaskDuration(item, now)` returns `{ elapsedMs, isRunning }` and is unit-tested for: never-started, running, completed, and re-opened tasks"
  - "Writes go through the existing PRD store so the single-file invariant and on-load migration behavior are preserved"
description: "Whenever a task transitions to in-progress (via `update_task_status`, `ndx work`, or MCP) capture a `startedAt`; when it transitions to completed capture an `endedAt`. Persist both on the PRD item in `.rex/prd.json` so duration is derivable without replaying the execution log. Handle the case where a task is picked up multiple times by accumulating active intervals rather than overwriting."
---
