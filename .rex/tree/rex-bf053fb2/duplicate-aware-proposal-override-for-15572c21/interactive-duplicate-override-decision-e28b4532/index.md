---
id: "e28b4532-a04a-4a0f-bbdc-2636edf9fb1e"
level: "task"
title: "Interactive Duplicate Override Decision Flow"
status: "completed"
source: "smart-add"
startedAt: "2026-02-22T21:11:08.060Z"
completedAt: "2026-02-22T21:11:08.060Z"
description: "Require explicit user confirmation when duplicates are detected, with clear choices to cancel, merge with existing work, or force-create anyway."
---

## Subtask: Implement merge-path application for user-selected duplicate proposals

**ID:** `26f6e5a1-a73c-4f6f-8444-0803d4bb3ea5`
**Status:** completed
**Priority:** high

Allow users to keep PRD quality high by merging duplicate proposals into existing nodes instead of creating parallel items.

**Acceptance Criteria**

- Selecting Merge updates the matched existing node rather than creating a new duplicate node
- Merged result preserves existing node identity and records which proposal was merged
- Cancelled proposals are not written when user chooses Merge for only a subset

---

## Subtask: Implement force-create path that bypasses duplicate block after explicit confirmation

**ID:** `42ceb6c6-a3c5-44a7-b2c2-a0489dd14b60`
**Status:** completed
**Priority:** high

Support intentional duplication for edge cases by allowing users to proceed anyway, while making the action explicit and auditable.

**Acceptance Criteria**

- Selecting Proceed anyway creates new items even when duplicate reasons are present
- Force-create requires explicit selection from the duplicate prompt and is never the default path
- Choosing Cancel exits without writing any new or merged items

---
