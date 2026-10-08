---
id: "3d03ab41-df50-4235-a057-f48a8af00ce7"
level: "task"
title: "Complete changes, split task-less changes and trigger apply"
status: "pending"
priority: "high"
tags:
  - "pr-16"
  - "lane-rex-domain"
  - "rex"
blockedBy:
  - "b0467938-b793-41ee-923d-cfd5c57322df"
source: "roadmap"
acceptanceCriteria:
  - "Completing the last task applies the change under applyOn complete (test)"
  - "The split rule moves criteria to the new first task (test)"
description: "A change completes when its tasks do (or on its own when task-less) and apply runs per rex.applyOn. When a task-less change in progress gains its first task, the in-flight work becomes that task carrying the change's criteria.\n\nDesign boundary, decided by Ryan on 2026-10-08. Follow it exactly; anything it does not allow is stop-and-report.\n\n1. Pure, no writes. Put the logic in a new module, packages/rex/src/core/change-completion.ts, working on a V2Tree (schema/v2-rules.ts). Each function returns the new tree plus a result naming what changed: the ids completed, the split performed (if any), and the applyOnTrigger result. It must not write to disk, take the PRD lock, call store.withTransaction, loadPrdModel or writePrdModel, or read config. rex.applyOn is passed in as an argument (the caller gets it from loadApplyOn). Wiring the result to a transactional write is not part of this task.\n\n2. Completion predicate: the same as v1. A change with tasks completes only when every live task is completed, judged by SUCCESSFUL_CHILD_STATUSES from core/parent-completion.ts (import it; do not copy the set). A cancelled task blocks completion. Deleted tombstones are ignored. Only a pending change auto-completes; an in_progress change is never swept (#368). Scope every check to the completed task's own change, never a whole-tree sweep. A task-less change completes on its own when its work is done.\n\n3. Apply on completion: when a change completes, call applyOnTrigger(tree, changeRef, \"complete\", ...) from core/apply-policy.ts. Apply runs only when applyOn is \"complete\". Under \"review\" or \"release\" the change is completed and stays unapplied (it stays open per isOpenChange). A touches-only change applies nothing. Do not reimplement apply.\n\n4. Split rule, one rule only: when a task-less change whose status is in_progress gains its first task, the new task takes in_progress (and the change's startedAt), the change goes back to pending, and the change's acceptanceCriteria MOVE to the new task (removed from the change, not copied). acceptanceCriteria is a passthrough key on changes (ChangeIntentSchema has no such field); move it only when present. requirements, amends and touches stay on the change. A change that is pending, or already has a task, is not split. Do not edit schema/v2.ts to add a field.\n\n5. v1 untouched: do not change core/next-task.ts or core/parent-completion.ts behaviour or signatures (importing SUCCESSFUL_CHILD_STATUSES is fine). Existing v1 tests must pass unedited. Do not touch store/, schema/v2.ts, MCP tools, CLI commands or packages/hench.\n\n6. Isolation test: add \"core/change-completion.ts\" to the v2 module set in packages/rex/tests/unit/schema/v2.test.ts (\"no runtime module imports the v2 modules yet\") and to its comment, exactly as task 1 did for core/change-selection.ts. No other file may import v2 modules.\n\n7. Add a patch changeset for @n-dx/rex. Say \"product layer\", never \"map\"."
lastModified: "2026-10-08T16:23:37.772Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
