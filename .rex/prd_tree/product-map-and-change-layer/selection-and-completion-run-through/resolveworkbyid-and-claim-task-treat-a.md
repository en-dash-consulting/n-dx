---
id: "fdb3a84a-bb5e-4397-817a-d71928f463e7"
level: "task"
title: "resolveWorkById and claim_task treat a change that holds a nested change as a runnable unit"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-34"
  - "rex"
blockedBy:
  - "5b52f367-ce20-4eb2-a53e-23293ced070f"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "resolveWorkById on a change whose live children include a change does not return it as a runnable change unit (test)"
  - "claim_task on a v2 change that holds only nested changes is refused, naming the nested work to claim instead (test)"
  - "findActionableWork, resolveWorkById and claim_task use one shared container predicate (test covering a change whose nested changes are all deleted, which stays a task-less unit)"
description: "Found reviewing 214ed10c (run e9e8febb). Verdict: should-fix. Severity medium.\n\nFailure scenario: 214ed10c made autonomous selection (findActionableWork, packages/rex/src/core/change-selection.ts) treat a change whose live children include a change as a container that is never a unit. Two explicit paths still treat it as a unit:\n- resolveWorkById (core/change-selection.ts, about line 120) returns { kind: \"change\", node: outer } for the outer change. Once hench runs `ndx work --task=<outer>` through it (stack B, roadmap PR 35), it would run the container as a task-less change instead of refusing or pointing at the nested change.\n- claim_task's changeLayerClaimRefusal (cli/mcp-tools/claim-task.ts) refuses only a change with live tasks. Claiming a change that holds only nested changes succeeds, though selection never offers that change, so the claim protects nothing and reads as if the work were held.\n\nReachability: resolveWorkById has no runtime caller yet (only tests and a doc reference in core/change-brief.ts). claim_task is reachable over MCP on a v2 tree today, but harmless.\n\nFix options:\n1. Recommended: share one \"is a unit of work\" predicate (live tasks or live nested changes means container) between findActionableWork, resolveWorkById and the claim_task refusal. resolveWorkById returns null, or a container kind the caller refuses, for a container. claim_task refuses with \"claim one of its nested changes or tasks instead\". Cheap; one predicate plus tests.\n2. Leave resolveWorkById permissive, since an explicit id is a deliberate ask, and fix only claim_task. Cheaper, but hench would then run a container."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T08:35:45.350Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
