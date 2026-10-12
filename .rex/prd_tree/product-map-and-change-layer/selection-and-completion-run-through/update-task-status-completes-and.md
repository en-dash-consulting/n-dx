---
id: "da3ca62b-0153-445b-a2ed-5c85886d8907"
level: "task"
title: "update_task_status completes and applies a change that holds an open nested change"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-34"
  - "rex"
blockedBy:
  - "fdb3a84a-bb5e-4397-817a-d71928f463e7"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "update_task_status completing a change that holds an open nested change is refused and writes nothing (test)"
  - "Completing the last task of the last open nested change completes a pending enclosing change and applies it per rex.applyOn (test)"
  - "A container change is never applied while a nested change is open (test)"
description: "Found reviewing 6a4bb0bf (run f5d0c83c). Verdict: should-fix. Severity medium.\n\nFailure scenario: on a v2 tree, change OUTER holds nested change INNER (pending, with an open task). `update_task_status { id: OUTER, status: \"completed\" }` (or `rex update OUTER --status=completed`) runs completeWork → completeChange (packages/rex/src/core/change-completion.ts). completeChange checks only live *tasks* (liveTasks filters type === \"task\"), so OUTER, which has no tasks, completes and, under rex.applyOn complete, its amendments apply to the product layer while INNER is still open. The reverse also holds: completing INNER's last task completes INNER but never re-checks OUTER, so a container whose nested changes are all done stays open.\n\nReachability: MCP and CLI on any v2 tree with a nested change (move_item allows a change under a change). The completion path became reachable in 6a4bb0bf; completeChange's predicate is from 3d03ab41.\n\nOptions:\n1. Recommended: treat a live nested change as blocking in completeChange (refuse while a nested change is open, like an open task), and after a change completes, re-check its enclosing change when it is pending and every live child task/change is done. Share the \"unit of work\" predicate the sibling resolveWorkById item proposes. Cost: small, plus tests. Risk: changes completion of containers that some tree already relies on (none on v1).\n2. Refuse to complete a container change outright. Cheaper, but leaves the container permanently open unless closed by hand."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T08:53:41.925Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
