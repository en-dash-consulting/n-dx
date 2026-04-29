---
id: "3d5d8464-5a5d-4b6a-a062-f39146a3191a"
level: "task"
title: "Single-Pane Preview/Raw Toggle"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T05:00:35.007Z"
completedAt: "2026-02-23T05:00:35.007Z"
acceptanceCriteria: []
description: "Replace side-by-side rendering with a single-pane mode switch between rendered preview and raw markdown."
---

## Subtask: Refactor PR markdown panel to single-pane mode

**ID:** `d8f517bf-f868-45c8-aef8-d304a9c157e9`
**Status:** completed
**Priority:** high

Update the PR markdown tab layout so only one representation is shown at a time, reducing visual clutter and improving focus.

**Acceptance Criteria**

- UI renders either Preview or Raw mode, never both simultaneously
- Default mode is Preview after opening or refreshing the tab
- Responsive tests confirm correct layout on mobile and desktop widths

---

## Subtask: Implement explicit Preview/Raw toggle control with persisted state

**ID:** `cc099982-724b-4155-89d3-9cfa224a58e1`
**Status:** completed
**Priority:** high

Add a clear toggle control so users can switch modes quickly, and persist their last-used mode during the session for convenience.

**Acceptance Criteria**

- Toggle control switches mode without page reload
- Selected mode persists across tab re-renders within the same session
- Accessibility checks confirm keyboard navigation and ARIA state updates

---
