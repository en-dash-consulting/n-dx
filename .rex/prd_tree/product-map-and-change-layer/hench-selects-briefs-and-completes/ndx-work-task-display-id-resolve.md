---
id: "ec23f1dd-c253-47da-a432-9a1674362b9b"
level: "task"
title: "ndx work --task=<display id> --resolve reports \"Task not found\" on a v2 tree"
status: "completed"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "pr-35"
  - "lane-hench"
  - "hench"
blockedBy:
  - "f0f2bab6-1130-4db4-bbce-54e4f8d8615d"
source: "ndx-adversarial-review"
startedAt: "2026-10-12T10:53:25.150Z"
completedAt: "2026-10-12T10:58:53.835Z"
endedAt: "2026-10-12T10:58:53.835Z"
resolutionType: "code-change"
resolutionDetail: "run-resolve.ts looks --task up with findV2Entry on a v2 tree (option a); claim check and claimed-elsewhere use entry.item.id. Commit e3c98fecf."
acceptanceCriteria:
  - "On a v2 tree, `ndx work --task=<display id> --resolve` reports the task whose real id resolveWorkById returns, with no task-not-found refusal (test)"
  - "The --resolve claim check uses the resolved real id, not the raw ref (test)"
  - "--resolve on a v1 tree is unchanged (existing tests pass unedited)"
description: "Found by the adversarial review of bf377f39 (run 03cb3ce3). Verdict: should-fix.\n\nScenario: on a v2 tree, `ndx work --task=CH-1 .` runs change CH-1, because bf377f39 resolves --task through rex's resolveWorkById. But `ndx work --task=CH-1 --resolve .` refuses with task-not-found. packages/hench/src/cli/commands/run-resolve.ts:238 still looks the ref up with findItem over the projected items, which matches real ids only. The claim check there (heldElsewhere(taskId)) also uses the raw ref instead of the real id.\n\nReachable: yes, through the CLI whenever --resolve is given a display id or alias. The dashboard passes real ids, so it is unaffected.\n\nOptions:\n(a) Recommended. In run-resolve.ts, when loadV2Tree(store) returns a tree, look the ref up with findV2Entry (agent/planning/work-selection.ts), then use entry.item.id for the claim check and the report. Cost: a few lines plus a test. Risk: low.\n(b) Have run-resolve call selectTaskEntry without claims. This shares more code, but selectTaskEntry throws, while resolve collects refusals."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T10:58:54.105Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
