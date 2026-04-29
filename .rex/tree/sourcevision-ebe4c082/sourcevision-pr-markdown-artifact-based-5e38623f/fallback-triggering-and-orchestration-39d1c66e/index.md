---
id: "39d1c66e-759d-4d23-a74d-1245a9187919"
level: "task"
title: "Fallback Triggering and Orchestration"
status: "completed"
source: "smart-add"
startedAt: "2026-02-23T01:11:08.148Z"
completedAt: "2026-02-23T01:11:08.148Z"
acceptanceCriteria: []
description: "Ensure PR markdown generation still succeeds when git-based fetch or diff operations fail by switching to a deterministic artifact-based fallback path."
---

## Subtask: Implement git-failure fallback routing in PR markdown refresh pipeline

**ID:** `96e3887b-b737-44c7-89a7-3b6f09c16826`
**Status:** completed
**Priority:** critical

Route refresh execution to a fallback generator whenever preflight, fetch, or diff stages fail so the endpoint returns usable PR content instead of only an error state.

**Acceptance Criteria**

- Given a simulated fetch failure, refresh returns HTTP success with fallback payload instead of aborting generation
- Given a simulated diff-stage failure, refresh returns fallback payload and does not clear previously cached successful markdown
- Fallback routing is only activated for classified git/preflight/diff failures and not for unrelated internal exceptions

---

## Subtask: Extract branch-relevant completed Rex work items for fallback summaries

**ID:** `a4f1f935-78d3-439b-aee8-ef138c590088`
**Status:** completed
**Priority:** high

Build a resolver that gathers completed epics/tasks associated with the active branch context so fallback output reflects actual delivered work.

**Acceptance Criteria**

- Resolver returns completed Rex items scoped to the current branch context when mappings exist
- Resolver excludes non-completed items from fallback summary inputs
- When no branch-scoped Rex items are found, resolver returns an explicit empty-result signal consumed by fallback metadata

---

## Subtask: Ingest Hench run artifacts into fallback summary input model

**ID:** `c1f3cf08-1918-41e8-80b8-ca4571facb0b`
**Status:** completed
**Priority:** high

Incorporate recent run artifacts as secondary evidence so fallback summaries include execution context when git diff evidence is unavailable.

**Acceptance Criteria**

- Fallback input model includes Hench run identifiers and task associations when artifacts are present
- Artifact parser tolerates missing or partial run fields without throwing
- Fallback generator omits Hench section cleanly when no valid artifacts are available

---
