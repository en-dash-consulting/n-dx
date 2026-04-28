---
id: "3c630e22-d440-4a94-a65a-d5009881ce1c"
level: "task"
title: "Interactive Element Placement Standardization"
status: "completed"
source: "smart-add"
startedAt: "2026-03-03T13:02:37.248Z"
completedAt: "2026-03-03T13:02:37.248Z"
description: "Rationalize the placement of action buttons, filters, and contextual controls across Rex pages — currently each page has invented its own layout for these, producing a disjointed experience"
---

## Subtask: Consolidate and reposition misplaced filter and sort controls in Rex PRD tree

**ID:** `4e691d1d-3709-4a7e-8275-c1d145c9b5d3`
**Status:** completed
**Priority:** medium

Filter controls (status filter, search, quick presets) are scattered at different vertical positions depending on which Rex sub-view is active. Consolidate them into a single persistent filter bar directly above the tree, visible on all Rex tree-based views.

**Acceptance Criteria**

- Status filter, search input, and quick filter presets appear in a single bar directly above the PRD tree on all Rex tree views
- Filter bar is sticky and remains visible when scrolling through a long tree
- Filter state persists when switching between Rex sub-views (e.g., Dashboard → tree and back)
- No filter controls appear below the tree or inside individual tree nodes

---

## Subtask: Standardize per-item action menus and inline control placement across Rex tree nodes

**ID:** `df1e460c-962d-4a24-9baf-218b5ab7716c`
**Status:** completed
**Priority:** medium

Task and epic nodes expose different controls in different positions — some show action buttons inline, some reveal them on hover, some have context menus that appear in unpredictable locations. Establish a single hover-reveal inline action pattern for all tree nodes.

**Acceptance Criteria**

- All tree nodes (epic, feature, task, subtask) reveal the same set of contextual actions (Edit, Delete, Change status) on hover using a consistent icon-button row
- Action buttons appear in the same position relative to the node label on every node type
- No node type shows actions in a floating dropdown that covers adjacent rows
- Keyboard navigation reaches inline node actions via Tab after the node label

---
