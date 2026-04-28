---
id: "2cae10b4-7d16-4b09-82b4-c0922d28a00f"
level: "task"
title: "Loop continuity"
status: "completed"
source: "llm"
startedAt: "2026-02-04T17:40:56.130Z"
completedAt: "2026-02-04T17:40:56.130Z"
description: "Enable continuous autonomous execution with proper error handling"
---

## Subtask: Add continuous loop mode

**ID:** `54b42890-14ca-40eb-9f45-e4e9a2e1ec83`
**Status:** completed
**Priority:** medium

Implement --loop flag to automatically continue to next task

**Acceptance Criteria**

- Automatically picks next task after completion
- Configurable pause between tasks
- Continues until no more tasks or manual stop

---

## Subtask: Implement stuck task detection

**ID:** `aff62817-8f65-4825-a380-5e1efbc411d8`
**Status:** completed
**Priority:** medium

Skip tasks after multiple failed attempts

**Acceptance Criteria**

- Detects 3+ failed attempts on same task
- Automatically skips stuck tasks
- Moves to next available task

---

## Subtask: Add clear error handling for invalid task selection

**ID:** `87fe384b-0e3e-49d8-8d36-3f25b8c8942b`
**Status:** completed
**Priority:** low

Error clearly when trying to work on completed or deferred tasks

**Acceptance Criteria**

- Clear error for completed tasks
- Clear error for deferred tasks
- Suggests alternative actions

---
