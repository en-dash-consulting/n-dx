---
id: "0a8093cf-e35f-424a-9fb6-3d6bda39f935"
level: "task"
title: "Status-based Tree Filtering"
status: "completed"
source: "smart-add"
startedAt: "2026-02-09T19:11:15.938Z"
completedAt: "2026-02-09T19:11:15.938Z"
acceptanceCriteria: []
description: "Add filtering controls to the Rex web dashboard tree view that allow users to show/hide items based on their status (pending, in_progress, completed, blocked, deferred, deleted)"
---

## Subtask: Add status filter UI controls to Rex dashboard

**ID:** `ca70d859-0747-4e0b-a5ff-5d42048a8861`
**Status:** completed
**Priority:** medium

Implement checkbox or dropdown interface in the Rex dashboard tree view that allows users to select which statuses to display

**Acceptance Criteria**

- Filter controls are prominently displayed above or beside the tree view
- All status options (pending, in_progress, completed, blocked, deferred, deleted) are available
- Multiple statuses can be selected simultaneously
- Filter state persists during the session

---

## Subtask: Implement tree filtering logic for status-based display

**ID:** `187d834c-b6dc-49b4-82fc-299c2c6d414c`
**Status:** completed
**Priority:** medium

Add client-side filtering functionality that hides/shows tree nodes based on selected status filters while maintaining proper hierarchy visualization

**Acceptance Criteria**

- Filtered items are completely hidden from the tree display
- Parent nodes remain visible if they have visible children
- Empty parent nodes are hidden when all children are filtered out
- Tree structure and indentation remain correct after filtering

---

## Subtask: Add quick filter presets for common status combinations

**ID:** `f95f94cf-5e6f-489c-b889-cc70d9da782a`
**Status:** completed
**Priority:** medium

Provide one-click filter presets like 'Active Work' (pending + in_progress), 'All Complete', 'Blocked Items', etc. to improve user experience

**Acceptance Criteria**

- At least 4 useful preset combinations are available
- Presets include 'Active Work', 'Completed', 'Blocked/Deferred', and 'All Items'
- Clicking a preset immediately updates the tree view
- Current filter state is clearly indicated in the UI

---
