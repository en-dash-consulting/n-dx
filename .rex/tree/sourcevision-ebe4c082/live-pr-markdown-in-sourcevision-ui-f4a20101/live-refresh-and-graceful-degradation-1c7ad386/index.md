---
id: "1c7ad386-e477-4dc3-87c8-deeb2ac1102e"
level: "task"
title: "Live Refresh and Graceful Degradation"
status: "completed"
source: "smart-add"
startedAt: "2026-02-21T05:40:54.335Z"
completedAt: "2026-02-21T05:40:54.335Z"
description: "Keep PR markdown current as repository state changes, while failing safely when git context is unavailable."
---

## Subtask: Implement auto-refresh triggers for file and git diff changes

**ID:** `9e459c9b-5a65-4f2e-bc16-67557b9b0548`
**Status:** completed
**Priority:** critical

Update the tab content automatically when the working tree or diff baseline changes so users always see current PR text without manual refresh.

**Acceptance Criteria**

- PR markdown refreshes automatically when tracked files change
- PR markdown refreshes automatically when git status/diff output changes
- Refresh logic debounces rapid changes to avoid duplicate renders
- UI shows timestamp of last successful refresh

---

## Subtask: Handle unavailable git data with explicit fallback states

**ID:** `73922339-310d-4b19-b3ad-09b77fa2582c`
**Status:** completed
**Priority:** high

Prevent broken UI behavior when running outside a git repo or when git commands fail by showing actionable fallback messaging.

**Acceptance Criteria**

- When git executable is missing, tab displays a clear unsupported-state message
- When current directory is not a git repository, tab shows a no-repo message
- When base branch cannot be resolved, tab still renders with partial metadata and warning
- Error states do not crash SourceVision server or other tabs

---

## Subtask: Add integration tests for refresh behavior and fallback scenarios

**ID:** `00abc668-92cb-46fc-a6b7-a48733e8d3c9`
**Status:** completed
**Priority:** medium

Protect the new workflow against regressions by covering normal refresh, dirty state updates, and git failure paths end-to-end.

**Acceptance Criteria**

- Integration test verifies markdown changes after simulated diff update
- Integration test verifies dirty/untracked indicators update after status change
- Integration test verifies fallback UI for non-git workspace
- All new tests pass in existing test pipeline

---
