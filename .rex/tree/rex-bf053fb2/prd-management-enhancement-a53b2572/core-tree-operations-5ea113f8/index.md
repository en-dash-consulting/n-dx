---
id: "5ea113f8-18e8-44b4-afd8-b0c381520a36"
level: "task"
title: "Core Tree Operations"
status: "completed"
source: "llm"
startedAt: "2026-02-09T13:45:09.477Z"
completedAt: "2026-02-09T13:45:09.477Z"
description: "Improve PRD tree manipulation and navigation"
---

## Subtask: Enhance next task selection logic

**ID:** `823574a9-471e-4bc5-b4f2-daab3d9c3767`
**Status:** completed
**Priority:** high

Improve findActionableTasks and explainSelection functions

**Acceptance Criteria**

- Task priority ordering is respected
- Blocked dependencies are handled correctly
- Selection explanation is clear and helpful

---

## Subtask: Harden tree operations and task selection

**ID:** `ccafa952-4145-4bdc-9731-0ebff91290d1`
**Status:** completed
**Priority:** medium

Harden tree traversal, search, manipulation (insert/update/remove), and statistics computation for correctness and performance. Enhance next-task selection with keyword extraction for matching and priority-based sorting.

**Acceptance Criteria**

- Progress statistics are accurate (counts all statuses, nested items)
- Parent chains are correctly computed
- Performance is optimized for large trees
- Tree structure remains consistent after insert/update/remove operations
- ID collection is complete and accurate
- Insertion respects hierarchy rules and creates children array if needed
- Traversal visits all items depth-first with correct parent chains
- findItem, updateInTree, and removeFromTree work for root and nested items
- Keywords are extracted from criteria and test names for task matching
- Matching scores are accurate and useful with minimal false positives
- Tasks are sorted by priority (critical first)

---

## Subtask: Implement proposal reconciliation

**ID:** `cdca0347-b1a1-4de3-a5ef-bc864bdfad58`
**Status:** completed
**Priority:** medium

Reconcile new proposals against existing PRD structure

**Acceptance Criteria**

- preserves non-matching proposals
- handles empty proposals list
- handles nested existing items
- filters when existing title contains proposal name

---
