---
id: "5b558cbb-b329-45e8-af46-b102eada7929"
level: "task"
title: "Smart add functionality"
status: "completed"
source: "llm"
startedAt: "2026-02-09T12:56:47.907Z"
completedAt: "2026-02-09T12:56:47.907Z"
description: "Allow natural language input that gets structured by LLM into proper PRD hierarchy"
---

## Subtask: Implement LLM-powered add command

**ID:** `75e2da1b-51c2-4dab-a9fe-c0f8591ea24e`
**Status:** completed
**Priority:** critical

Send description to Claude to determine hierarchy and create full breakdown

**Acceptance Criteria**

- Command accepts natural language input
- LLM creates appropriate epic/feature/task structure
- Existing PRD provided as context to avoid duplicates

---

## Subtask: Add approval flow for LLM proposals

**ID:** `5c160a8b-ad78-44f6-9335-444e7727ccfd`
**Status:** completed
**Priority:** high

Present proposed tree structure for user approval before inserting

**Acceptance Criteria**

- Shows proposed structure before adding
- User can approve or reject proposals
- Only approved items are added to PRD

---

## Subtask: Support scoped additions with parent constraint

**ID:** `9e5d1d9c-6306-4255-9906-47329993307e`
**Status:** completed
**Priority:** medium

Allow constraining new items under existing parent with --parent flag

**Acceptance Criteria**

- Accepts --parent=<epic-id> parameter
- LLM expansion stays within specified parent
- Auto-determines placement when no parent specified

---

## Subtask: Maintain explicit manual mode

**ID:** `1d92f102-9a80-4234-a3e9-f713ed42ab61`
**Status:** completed
**Priority:** medium

Support direct task creation bypassing LLM with explicit parameters

**Acceptance Criteria**

- Commands with --title and --parent work as before
- Manual mode bypasses LLM processing
- Explicit level specification supported

---

## Subtask: Implement bidirectional parent status cascade

**ID:** `f6d75214-9714-41b0-8467-7ae40e412dc3`
**Status:** completed
**Priority:** medium

Automatically manage parent status in both directions: reset completed parents when new children are added, and auto-complete parents when all children are completed.

**Acceptance Criteria**

- Parent epic status resets to 'pending' when new features or tasks are added
- Parent feature status resets to 'pending' when new tasks are added
- Only affects parents that are currently marked as 'completed'
- Status reset cascades up the hierarchy if needed
- Works for both manual add commands and LLM-generated proposals
- Features auto-complete when all child tasks complete
- Epics auto-complete when all child features complete
- State propagation works correctly in both directions

---
