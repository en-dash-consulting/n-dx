---
id: "a62d284c-e430-4c74-aadf-1972f2d913c0"
level: "task"
title: "Hench Run Deep-linking"
status: "completed"
source: "smart-add"
startedAt: "2026-02-18T08:05:25.131Z"
completedAt: "2026-02-18T08:05:25.131Z"
acceptanceCriteria: []
description: "Enable direct navigation to specific hench execution runs with automatic page routing, run selection, and transcript visibility\n\n---\n\nEnable direct navigation to specific PRD items with automatic page routing, item selection, and visibility\n\n---\n\nProvide consistent URL generation for shareable deep-links across all Rex and Hench items"
---

## Subtask: Implement complete Hench run deep-linking

**ID:** `bafb2115-1e54-4462-bd8b-3ec8458c288a`
**Status:** completed
**Priority:** high

Add URL-based routing to navigate directly to specific hench runs with automatic selection, transcript opening, and visibility management

**Acceptance Criteria**

- URLs with run IDs automatically navigate to the Hench runs page
- Target run is expanded and visible when page loads
- Target run is visually highlighted and selected when page loads
- Run details or transcript panel opens automatically
- Page scrolls to make the target run visible in the list
- Invalid run IDs show appropriate error handling

---

## Subtask: Implement complete Rex task deep-linking

**ID:** `735ab51a-d31a-4256-b9b7-054e44068a22`
**Status:** completed
**Priority:** high

Add URL-based routing to navigate directly to specific rex tasks with automatic selection, highlighting, and scroll-to-view functionality

**Acceptance Criteria**

- URLs with task IDs automatically navigate to the correct Rex page
- Task hierarchy is expanded to show the target item
- Target task is visually highlighted when page loads via deep-link
- Page scrolls to make the target item visible
- Selection state persists during page interactions
- Invalid task IDs show appropriate error handling

---

## Subtask: Add shareable link generation across all items

**ID:** `3b3c805f-ad42-4f4d-bb25-5b59518db180`
**Status:** completed
**Priority:** medium

Add UI controls to generate and copy shareable deep-links for any rex task, feature, epic, or hench run from the web interface

**Acceptance Criteria**

- Copy link button available on all rex items
- Copy link button available on all hench runs
- Generated URLs include proper base path and item/run ID
- Links work when shared across different browser sessions

---
