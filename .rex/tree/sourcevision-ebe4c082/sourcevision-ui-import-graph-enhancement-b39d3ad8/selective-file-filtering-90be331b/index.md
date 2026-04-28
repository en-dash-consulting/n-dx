---
id: "90be331b-39aa-4b13-8a38-23e72242e221"
level: "task"
title: "Selective file filtering"
status: "completed"
source: "smart-add"
startedAt: "2026-02-18T09:18:06.075Z"
completedAt: "2026-02-18T09:18:06.075Z"
description: "Filter out internal tool directories from the default Files page view while providing an option to show all files"
---

## Subtask: Implement file filtering logic for internal directories

**ID:** `95cb4832-189c-4d06-8023-80964879c6f4`
**Status:** completed
**Priority:** medium

Add filtering logic to hide .hench, .rex, and .sourcevision directories from the Files page by default, while preserving the full file inventory data

**Acceptance Criteria**

- Files page hides .hench, .rex, and .sourcevision directories by default
- Filtered directories are completely excluded from the file list display
- File count reflects only visible files when filtering is active
- Filter state persists within the user session

---

## Subtask: Add toggle control for showing all files

**ID:** `92ebb1f8-7cce-459b-a010-ecb2a211e4f1`
**Status:** completed
**Priority:** medium

Implement a toggle button or checkbox that allows users to show all files including internal tool directories when needed

**Acceptance Criteria**

- Toggle control is clearly labeled (e.g., 'Show All Files')
- Toggle immediately updates the file list without page refresh
- Toggle state is visually indicated (checked/unchecked or active/inactive)
- Toggle is positioned prominently but not intrusively in the Files page header

---
