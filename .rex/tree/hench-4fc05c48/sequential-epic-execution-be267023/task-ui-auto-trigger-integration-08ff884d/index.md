---
id: "08ff884d-a41a-441d-94d7-7a8d08c2db75"
level: "task"
title: "Task UI Auto-trigger Integration"
status: "completed"
source: "smart-add"
startedAt: "2026-02-13T18:38:07.908Z"
completedAt: "2026-02-13T18:38:07.908Z"
description: "Enable automatic Hench execution directly from individual tasks in the Rex task UI view"
---

## Subtask: Implement task-specific auto-trigger system

**ID:** `7da1e0d9-ea81-48f4-96a8-51374db850bb`
**Status:** completed
**Priority:** high

Create complete auto-trigger functionality including UI button, API endpoint, and task-scoped Hench execution for individual tasks in the Rex dashboard

**Acceptance Criteria**

- Task items display an auto-trigger action button
- Button is only enabled for tasks in pending or blocked status
- Button shows appropriate loading state during execution
- Action is disabled for completed or in_progress tasks
- POST endpoint accepts task ID and starts Hench run
- Endpoint validates task exists and is actionable
- Returns run ID and status for tracking
- Handles concurrent execution requests gracefully
- Hench run accepts --task=ID parameter
- Skips task selection and works directly on specified task
- Validates task is actionable before starting
- Updates task status appropriately during execution

---

## Subtask: Add real-time execution status updates

**ID:** `3908405f-3a16-48a6-9de8-a284ef529e5f`
**Status:** completed
**Priority:** medium

Add WebSocket or polling mechanism to show live progress of auto-triggered Hench runs in the task UI

**Acceptance Criteria**

- UI shows real-time status updates during execution
- Progress indicator reflects current Hench operation
- Task status updates automatically when run completes
- Error states are displayed clearly to user

---
