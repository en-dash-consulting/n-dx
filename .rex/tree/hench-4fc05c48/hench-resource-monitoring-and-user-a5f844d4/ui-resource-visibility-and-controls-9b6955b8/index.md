---
id: "9b6955b8-74b9-46cc-ab58-ea8ce5ae5ac8"
level: "task"
title: "UI Resource Visibility and Controls"
status: "completed"
source: "smart-add"
startedAt: "2026-02-26T20:39:57.069Z"
completedAt: "2026-02-26T20:39:57.069Z"
acceptanceCriteria: []
description: "Provide user interface elements to display resource usage, execution limits, and manual controls for hench process management"
---

## Subtask: Display concurrent execution count and limits in Hench UI

**ID:** `82e0aa11-9c52-4fa3-b7ac-165f0db47d5d`
**Status:** completed
**Priority:** high

Add real-time display of current concurrent hench executions, configured limits, and queue status to the Hench dashboard section

**Acceptance Criteria**

- Current/max concurrent process count displayed prominently
- Queue length and pending task count visible
- Visual indicators for approaching resource limits
- Updates in real-time via WebSocket or polling

---

## Subtask: Show memory usage and system resource status in execution panel

**ID:** `293e9411-dc86-4c8c-a1df-2495810b1e89`
**Status:** completed
**Priority:** medium

Integrate system memory usage, per-process memory consumption, and resource health indicators into the active execution monitoring panel

**Acceptance Criteria**

- System memory usage percentage displayed
- Individual task memory consumption shown
- Resource health indicators (green/yellow/red status)
- Memory pressure warnings visible to users

---

## Subtask: Add manual execution throttling controls and emergency stop

**ID:** `48ac348c-edbc-46d0-8a22-a70565207af8`
**Status:** completed
**Priority:** medium

Implement user controls to manually adjust concurrency limits, pause new executions, and emergency stop all running processes when needed

**Acceptance Criteria**

- Manual concurrency limit adjustment via UI
- Pause/resume button for new task execution
- Emergency stop all executions button with confirmation
- Throttling status and control state clearly indicated

---
