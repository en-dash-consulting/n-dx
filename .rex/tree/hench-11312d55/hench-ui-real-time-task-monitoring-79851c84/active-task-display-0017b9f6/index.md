---
id: "0017b9f6-0247-4b31-9eb6-7bc38fbc5183"
level: "task"
title: "Active Task Display"
status: "completed"
source: "smart-add"
startedAt: "2026-02-18T06:47:01.266Z"
completedAt: "2026-02-18T06:47:01.266Z"
description: "Create a prominent display for currently running tasks in the Hench UI"
---

## Subtask: Implement active task status panel in Hench UI

**ID:** `e5fecbf6-877c-42a6-9060-29691b495b38`
**Status:** completed
**Priority:** high

Add a dedicated panel to the Hench dashboard that shows all currently executing tasks with their status, progress, and execution time

**Acceptance Criteria**

- Panel displays all in_progress tasks prominently at the top of the Hench UI
- Shows task title, start time, and current execution duration
- Updates in real-time as task status changes
- Visually distinct from completed/pending tasks

---

## Subtask: Add task execution health monitoring

**ID:** `b6baaa8a-26a0-4050-9b54-2f25fd4cc066`
**Status:** completed
**Priority:** high

Implement system to verify that running tasks are actually still executing and not stuck or crashed

**Acceptance Criteria**

- Detects when a task marked as in_progress has stopped executing
- Shows warning indicators for potentially stuck tasks
- Provides last-activity timestamp for running tasks
- Allows manual intervention to mark stuck tasks as failing

---
