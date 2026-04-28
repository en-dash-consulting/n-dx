---
id: "4ac64ac1-fa02-4f8a-b0b3-45faa30b69ac"
level: "task"
title: "Better task lifecycle"
status: "completed"
source: "llm"
startedAt: "2026-02-04T15:43:05.711Z"
completedAt: "2026-02-04T15:43:05.711Z"
description: "Improve task status management and tracking throughout lifecycle"
---

## Subtask: Add blocked status

**ID:** `8c0107fc-f568-4649-8e6c-7c81ce45f22b`
**Status:** completed
**Priority:** medium

Distinguish blocked tasks from deferred tasks

**Acceptance Criteria**

- blocked status added to schema
- Distinct from deferred status
- Used for dependency-blocked tasks

---

## Subtask: Add explanation to rex next

**ID:** `a42cfc8a-51c6-4183-b133-19f635c48dad`
**Status:** completed
**Priority:** low

Explain why a particular task was selected

**Acceptance Criteria**

- Shows selection reasoning
- Explains priority considerations
- Notes dependency status

---

## Subtask: Validate status transitions

**ID:** `a080f709-e5aa-4672-9043-8088b512f964`
**Status:** completed
**Priority:** medium

Prevent invalid status changes without explicit force

**Acceptance Criteria**

- Prevents completed -> pending without --force
- Validates all transition rules
- Clear error messages for invalid transitions

---

## Subtask: Add automatic timestamping

**ID:** `98ee2a19-494b-4717-810f-8d484c58a7ee`
**Status:** completed
**Priority:** low

Track startedAt and completedAt timestamps on status changes

**Acceptance Criteria**

- startedAt set when task becomes in_progress
- completedAt set when task completes
- Timestamps included in status output

---
