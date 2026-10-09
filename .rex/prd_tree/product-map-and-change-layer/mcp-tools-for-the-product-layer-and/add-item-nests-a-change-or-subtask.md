---
id: "ce39ed74-6789-480c-b299-e42a36ab2b42"
level: "task"
title: "add_item nests a change or subtask under a closed change, bypassing the follow-up rule"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-17"
  - "rex"
  - "lane-rex-surface"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "add_item type change with parentId of a completed, applied, cancelled or deleted change is refused, and the message suggests a follow-up change with discoveredFrom (test)"
  - "add_item type subtask under a task whose change is closed is refused (test)"
  - "add_item still nests a change under an open change, and a subtask under a task of an open change (test)"
  - "On a v1 tree, add_item behaves exactly as today (test)"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
description: "Verdict: should-fix (adversarial review of fdddee24, add_item takes a type).\n\nScenario: on a v2 tree, add_item {type: \"change\", parentId: <completed/applied/cancelled change>} succeeds and nests an open change under closed work. So does add_item {type: \"subtask\", parentId: <task of a closed change>}. Only the task path refuses, through addTask's ClosedChangeError. Work found after a change closed should be a follow-up change with discoveredFrom, and these two paths get around that rule.\n\nEvidence: packages/rex/src/core/change-add.ts. The parent check (PARENT_TYPE plus the `parent?.type !== want.type` guard) tests the type but not the closed state. closedState in core/change-completion.ts is private.\n\nReachable: the MCP add_item tool on any v2 tree.\n\nOptions:\n(a) Export the closed-state predicate from change-completion.ts. In addChangeNode, refuse a change whose parent is closed and a subtask whose enclosing change is closed, with the same ClosedChangeError message. Cheap; recommended.\n(b) Decide that v2 changes never nest, and refuse parentId on type change entirely. This is a design decision for Ryan, since v1-read trees nest epics and features as changes.\n\nDecided 2026-10-08 (Ryan): option (a). Changes may still nest under an open change; only a closed parent (completed, applied, cancelled or deleted, the same states addTask refuses) is refused, with the same ClosedChangeError message suggesting a follow-up change with discoveredFrom. Option (b), never nesting changes, is not taken: get_prd_status already counts nested Inbox changes. Lane: core/change-add.ts and core/change-completion.ts (export the closed-state predicate), plus tests. No MCP tool shape changes."
lastModified: "2026-10-09T02:03:50.915Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
