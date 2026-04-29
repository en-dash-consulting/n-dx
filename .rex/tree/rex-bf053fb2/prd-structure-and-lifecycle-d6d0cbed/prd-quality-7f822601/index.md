---
id: "7f822601-2e01-4a98-adc2-3426481da3f2"
level: "task"
title: "PRD quality"
status: "completed"
source: "llm"
startedAt: "2026-02-04T17:12:50.586Z"
completedAt: "2026-02-04T17:19:07.553Z"
acceptanceCriteria: []
description: "Tools to maintain and clean up PRD structure and content"
---

## Subtask: Enhance rex validate with structural checks

**ID:** `6834c45c-3f27-4ffb-9042-34d79edba35b`
**Status:** completed
**Priority:** medium

Check for orphaned items, circular dependencies, and stuck tasks

**Acceptance Criteria**

- Detects orphaned items
- Finds circular blockedBy references
- Identifies tasks stuck in_progress too long

---

## Subtask: Add rex prune command

**ID:** `a3508f63-7ca4-4f9a-ba05-afb73a67442c`
**Status:** completed
**Priority:** low

Remove completed subtrees and archive them

**Acceptance Criteria**

- Removes completed items
- Archives to separate file
- Preserves history

---

## Subtask: Add rex import alias

**ID:** `d6520294-3587-410f-965f-99370db07d26`
**Status:** completed
**Priority:** low

Create synonym for rex analyze --file for discoverability

**Acceptance Criteria**

- rex import works as alias
- Maintains same functionality
- Documented in help

---
