---
id: "8e04e63b-854c-4e25-9689-3a261ed2d20d"
level: "task"
title: "Orphaned Parent Cleanup After Smart-Add Merge"
status: "completed"
source: "smart-add"
startedAt: "2026-03-06T07:38:57.447Z"
completedAt: "2026-03-06T07:38:57.447Z"
acceptanceCriteria: []
description: "When the smart-add merge path is applied, the proposed parent epic container can be written to the PRD before the merge target is resolved, leaving it as an empty or childless node. This feature covers the fix and regression coverage."
---

## Subtask: Fix orphaned epic creation in smart-add merge path

**ID:** `556276b8-b57e-434e-a98a-b3033e2c7bc2`
**Status:** completed
**Priority:** high

Trace the merge execution path in the smart-add pipeline to identify where the proposed parent epic is instantiated before merge resolution completes. The bug produces an empty or single-child epic that is structurally disconnected after the merge target absorbs the child item. The fix should defer or suppress parent creation when a merge is confirmed, or clean up any empty containers after the merge operation settles. Verify the fix against both cross-level and same-level merge scenarios.

**Acceptance Criteria**

- Performing a smart-add merge does not create a new top-level epic that has no children after the operation completes
- If a parent epic was legitimately created as part of the merge (e.g. to group merged children), it is retained with its children intact
- Running `rex validate` after a merge produces no orphaned-node errors
- Existing merge behavior for same-level and cross-level matches is unchanged

---

## Subtask: Add regression tests for orphaned parent scenarios in smart-add merge

**ID:** `3adce9c5-d919-465c-affb-1c09b1ee5c16`
**Status:** completed
**Priority:** medium

Add unit and integration tests that reproduce the orphaned-epic condition before the fix and confirm it stays resolved. Tests should cover: (1) merge into an existing item where the proposed parent is new, (2) cross-level merge where the parent already exists, and (3) merge followed by `rex validate` asserting a clean PRD.

**Acceptance Criteria**

- A test reproducing the orphaned-epic bug exists and fails on the pre-fix code path
- The same test passes after the fix is applied
- A cross-level merge regression test confirms no empty containers are left
- `rex validate` is called as part of at least one integration test and returns no structural errors

---
