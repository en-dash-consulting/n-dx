---
id: "3ad7b27b-3eda-4de3-b546-c2bbeadc8d48"
level: "task"
title: "Task Selection and Prioritization"
status: "completed"
source: "llm"
startedAt: "2026-02-09T15:33:53.407Z"
completedAt: "2026-02-09T15:42:15.466Z"
acceptanceCriteria: []
description: "Advanced algorithms for selecting optimal next tasks"
---

## Subtask: Implement task filtering logic

**ID:** `65c11692-f57b-463d-8e9f-79706efbd04d`
**Status:** completed
**Priority:** high

Filter out non-actionable tasks based on status and dependencies

**Acceptance Criteria**

- collects completed item ids
- skips completed items
- skips deferred items
- skips blocked items
- skips items with unresolved blockers
- unblocks items when blockers are completed

---

## Subtask: Implement priority-based task selection

**ID:** `26b1b3bf-44eb-4b0b-b9ff-5470f8200f03`
**Status:** completed
**Priority:** high

Select tasks based on priority with proper tiebreaking rules

**Acceptance Criteria**

- goes depth-first into children
- selects critical task in low-priority epic over medium task in high-priority epic
- prefers in_progress tasks over pending tasks of same priority
- prefers in_progress tasks even at lower priority
- ranks in_progress tasks before pending at same priority
- uses ancestor priority as tiebreaker for same-priority tasks

---

## Subtask: Handle cross-epic task selection

**ID:** `81ac2225-0b57-4a0b-9a58-906a6979e07a`
**Status:** completed
**Priority:** medium

Select high-priority tasks across different epics appropriately

**Acceptance Criteria**

- selects critical tasks across epics regardless of epic priority

---

## Subtask: Implement completion propagation

**ID:** `bc9b3d74-39e7-4f88-a0ad-8a72bfb8696b`
**Status:** completed
**Priority:** medium

Automatically mark parent items as complete when all children are done

**Acceptance Criteria**

- propagates up multiple levels
- stops propagation when a sibling feature is incomplete
- auto-completes pending parent (not just in_progress)
- handles deeply nested trees (4 levels)

---
