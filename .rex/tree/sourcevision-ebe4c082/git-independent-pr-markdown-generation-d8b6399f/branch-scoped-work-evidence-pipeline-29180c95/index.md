---
id: "29180c95-a958-4aac-b903-7af82fdb16e2"
level: "task"
title: "Branch-Scoped Work Evidence Pipeline"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T04:27:36.131Z"
completedAt: "2026-02-23T04:27:36.131Z"
description: "Make PR markdown generation rely on Rex and Hench artifacts from the active branch instead of repository diff connectivity."
---

## Subtask: Implement branch-scoped Rex work item collector

**ID:** `32f4490a-631a-408e-8996-40c25a8843b9`
**Status:** completed
**Priority:** critical

Build a collector that selects epics, features, and tasks relevant to the current branch from Rex state so PR summaries are grounded in planned and completed work, not git remote reachability.

**Acceptance Criteria**

- Collector returns only Rex items associated with the active branch context
- Collector excludes deleted items and includes status and completion timestamps when present
- Unit tests cover mixed-branch datasets and verify no cross-branch leakage

---

## Subtask: Implement branch-scoped Hench run evidence collector

**ID:** `96fd82eb-e8c8-462f-9199-bd71bbcc6b6e`
**Status:** completed
**Priority:** critical

Add a run evidence layer that gathers executed-task context from Hench runs tied to the active branch so generated PR markdown reflects actual execution history.

**Acceptance Criteria**

- Collector returns Hench runs linked to the active branch and related Rex task IDs
- Collector surfaces run outcomes and timestamps for summary generation
- Integration tests validate correct filtering when runs exist for multiple branches

---

## Subtask: Replace git-remote dependency in PR markdown refresh flow

**ID:** `4686bf57-efac-43ee-8bda-49a03644473d`
**Status:** completed
**Priority:** critical

Refactor the refresh pipeline to use the Rex/Hench branch evidence collectors as the primary and required data source, eliminating dependency on external git repository connectivity.

**Acceptance Criteria**

- PR markdown refresh completes successfully when remote git fetch is unavailable
- Refresh path does not invoke remote connectivity checks in normal generation mode
- Regression tests confirm markdown generation is deterministic from Rex/Hench evidence only

---
