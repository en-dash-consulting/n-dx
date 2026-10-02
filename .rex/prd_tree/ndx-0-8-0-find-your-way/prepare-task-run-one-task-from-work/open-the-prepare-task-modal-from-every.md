---
id: "e403f6ec-ee47-477e-9fd5-981b0a31b405"
level: "task"
title: "Open the Prepare task modal from every existing Start button and retire the PRD panel's separate Execute path"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "task-prep"
  - "phase-1"
  - "web-viewer"
blockedBy:
  - "379bf324-8797-49ca-8eba-f83e370dacdd"
acceptanceCriteria:
  - "All five surfaces open the Prepare task modal on primary click, and Start now still starts with no options."
  - "Start now shows queued with its position when the hub queues the run, never \"started\"."
  - "ExecuteTaskButton and its private execution code are removed; the PRD panel shows the split button, or a link to the Live task page while a run is live."
  - "Blocked tasks show their blockers instead of a start button; in-progress tasks with no live run show Resume."
  - "Patch changeset for @n-dx/web."
description: "Five buttons start a task today, through two code paths. StartTaskButton (components/start-task-button.ts:40) is mounted in the Rex Dashboard Up Next card (views/rex-dashboard.ts:442), the Hench Runs empty state (views/hench-runs.ts:1400), the Live idle card (views/live.ts:474) and each Workspaces card (views/workspaces.ts:512, which passes a workspace key). The PRD task detail panel has its own ExecuteTaskButton (components/prd-tree/task-detail.ts:1043, wired by hooks/use-prd-actions.ts:240) with no migrate-slugs recovery, a Rules-of-Hooks bug (the early `return null` at ~1178 runs before a useCallback), and a Stop with no confirmation that ignores errors.\n\nMake StartTaskButton a split button: the primary click opens the Prepare task modal (passing the workspace key through so the modal sends X-Ndx-Workspace), and its menu keeps \"Start now\" — the current one-click behaviour. Today a hub-queued 202 is treated as started; Start now must show the queued state and position instead. Replace ExecuteTaskButton with the same split button and delete its private execute/progress code; while a run is live for the task, show a link to /live/task/:taskId instead (Stop lives in Live). Gating everywhere: offer the button for pending, deferred, and in-progress tasks with no live run (labelled Resume); for blocked tasks show what they wait on instead of a button."
lastModified: "2026-10-02T04:55:45.596Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
