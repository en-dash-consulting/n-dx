---
id: "ddd88998-9b4f-45af-b73c-92ceb28e72d6"
level: "task"
title: "An explicit --task refuses a task whose enclosing change another worktree has claimed"
status: "completed"
priority: "medium"
tags:
  - "pr-35"
  - "review-2026-10-12"
  - "lane-hench"
blockedBy:
  - "76bd115f-2f0e-4410-b6c2-d1e314e277af"
source: "review-2026-10-12"
startedAt: "2026-10-13T04:41:20.758Z"
completedAt: "2026-10-13T04:48:07.708Z"
endedAt: "2026-10-13T04:48:07.708Z"
resolutionType: "code-change"
resolutionDetail: "v2 explicit --task refuses when another worktree claims an enclosing change"
acceptanceCriteria:
  - "On a v2 copy where another worktree's claim holds change C, `ndx work --task=<task in C>` (selectTaskEntry with an explicit id) is refused with TaskClaimedElsewhereError naming C and its holder, and claims nothing (test that fails on the current head)"
  - "An explicit task whose enclosing changes are unclaimed, or claimed by this worktree, is claimed as today (test)"
  - "enclosingChangeIds reaches hench only through rex-gateway.ts; the gateway ceiling and contract lists are updated"
  - "v1 explicit-task claiming and autoselection are unchanged; existing brief and claims tests pass unedited"
description: "Hench half of 76bd115f (PR 34), found by the adversarial review of 880d8c8e (run 0336e4a0). Decision (Ryan, 2026-10-12): in this round; the rex half (exporting enclosingChangeIds from public.ts) is 76bd115f, and this task is blocked by it.\n\nDefect: since 880d8c8e a claim on a v2 change covers the work inside it, and rex enforces that on both sides: findActionableWork skips a unit inside a change another worktree has claimed, and claim_task (cli/mcp-tools/claims.ts, acquireWorkClaim) refuses it. hench's autoselection inherits this because it asks rex (nextV2Entry with excludeIds). hench's explicit path does not: packages/hench/src/agent/planning/brief.ts selectTaskEntry, the `if (taskId)` branch, resolves the entry (resolveV2Entry on v2) and calls `claims.claim(entry.item.id)`, which checks only the task's own id.\n\nFailure scenario: worktree A sets task-less change C in_progress (claiming C) and splits it into task T. Worktree B runs `ndx work --task=T` (or the dashboard runs T). B claims T and works it alongside A, the double-pick claims exist to prevent. The review judged it unreachable \"because hench is still v1\"; that is wrong at this layer, which makes hench run on v2.\n\nFix: on a v2 tree, before claiming an explicit task, ask rex for its enclosing change ids (enclosingChangeIds, through src/prd/rex-gateway.ts, re-export only, with a \"Raised from X to Y\" ceiling entry in tests/e2e/architecture-policy.test.js and the cross-package contract lists) and refuse with the same TaskClaimedElsewhereError the explicit path uses today when another worktree holds any of them, naming the change and its holder. v1 and autoselection are unchanged."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-13T04:48:08.512Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
