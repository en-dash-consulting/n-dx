---
id: "07714a07-008e-4254-a0cd-56b15766afa4"
level: "task"
title: "Populate branch attribution on item create and edit across all write paths"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "hench"
  - "mcp"
  - "backend"
source: "smart-add"
startedAt: "2026-04-24T16:45:55.383Z"
completedAt: "2026-04-24T16:57:13.824Z"
acceptanceCriteria:
  - "`rex add` and `ndx add` set `branch` to the current git branch on newly created items"
  - "MCP `add_item` and `edit_item` set `branch` to the current git branch at call time"
  - "Hench runs set `branch` on the task they act on at run start"
  - "`update_task_status` updates `branch` to reflect the branch active at the time of the status change"
  - "Branch detection fails gracefully when git is unavailable — field is omitted rather than crashing"
  - "`sourceFile` is set to the resolved path of the active `.rex/prd.json` (or markdown equivalent) at write time"
description: "When a PRD item is created or updated through any write path — `rex add`, `ndx add`, MCP `add_item`/`edit_item`/`update_task_status`, or a hench run — automatically capture the current git branch and PRD file path as attribution metadata. This makes attribution automatic rather than opt-in, ensuring the UI has data to display without requiring user action."
---
