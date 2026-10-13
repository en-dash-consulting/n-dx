---
id: "deba7cde-4887-49cb-ae3a-4cf79a17320d"
level: "task"
title: "On a v2 tree, --resolve reports a subtask or container-change ref as \"Task not found\" instead of the run's reason"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "pr-35"
  - "lane-hench"
  - "hench"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a v2 tree, --resolve with a subtask id reports a refusal whose message matches the run's (\"is a subtask ... Run the task instead\") (test)"
  - "On a v2 tree, --resolve with a container change id reports a refusal whose message matches the run's (\"holds other changes\") (test)"
  - "--resolve on a v1 tree is unchanged (existing tests pass unedited)"
description: "Found by the adversarial review of ec23f1dd (run 4bd60df2). Verdict: should-fix.\n\nScenario: on a v2 tree, `ndx work --task=<subtask id> --resolve .` (or a change that holds nested changes) reports refusal task-not-found, \"Task not found: <ref>\", hint \"Check the id with 'ndx status'\". The run itself (resolveV2Entry, packages/hench/src/agent/planning/work-selection.ts:106) refuses the same ref with the real reason: \"is a subtask; it runs with its task. Run the task instead.\" or \"holds other changes, so it is not a unit of work\". packages/hench/src/cli/commands/run-resolve.ts uses findV2Entry, which returns null for both, so the dashboard and CLI show a misleading reason. The refusal itself is correct (the run would refuse too).\n\nReachable: CLI --resolve with a subtask/container-change id; the dashboard prep panel if it ever passes such an id.\n\nOptions:\n(a) Recommended. In run-resolve.ts, on v2 call resolveV2Entry inside try/catch and report the caught message as the refusal (code task-not-found, or a new not-a-unit code). Cost: a few lines + test. Risk: low; the catch converts a throw into a reported refusal, which is resolve's contract.\n(b) Export a non-throwing variant from work-selection.ts returning {entry} | {reason}, used by both resolveV2Entry and run-resolve. Slightly more code, no try/catch."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T10:59:20.015Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
