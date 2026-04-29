---
id: "d0937fc9-9d94-408f-b5d2-3b5666b55e17"
level: "task"
title: "Flexible hierarchy"
status: "completed"
source: "llm"
startedAt: "2026-02-04T16:12:38.681Z"
completedAt: "2026-02-04T16:12:38.681Z"
acceptanceCriteria: []
description: "Allow more flexible organization of PRD items beyond rigid four-level structure"
---

## Subtask: Allow tasks directly under epics

**ID:** `23402c98-4566-4d51-9f98-3c353988b2a9`
**Status:** completed
**Priority:** medium

Support skipping feature level when not needed

**Acceptance Criteria**

- Tasks can have epics as direct parents
- Feature level becomes optional
- Existing hierarchy still supported

---

## Subtask: Implement task-to-task dependencies

**ID:** `2938285a-01bf-4eb2-8ff9-6ef1ef6315da`
**Status:** completed
**Priority:** high

Ensure blockedBy field is fully respected in work selection

**Acceptance Criteria**

- blockedBy prevents task selection
- Dependency resolution works correctly
- Circular dependencies detected

---

## Subtask: Add move command for reparenting

**ID:** `a143409d-3428-4e11-8332-31c0c8c284a7`
**Status:** completed
**Priority:** low

Support moving items to different parents in the tree

**Acceptance Criteria**

- Can change parent of any item
- Validates move is structurally valid
- Updates references correctly

---
