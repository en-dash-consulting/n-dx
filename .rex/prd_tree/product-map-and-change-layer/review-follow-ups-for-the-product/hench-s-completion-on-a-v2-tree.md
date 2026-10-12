---
id: "c1c8888b-be09-4ba6-9598-144eca831802"
level: "task"
title: "hench's completion on a v2 tree bypasses change-completion and never applies the change"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "pr-34"
  - "pr-35"
  - "hench"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A hench run that completes the last task of a pending change on a v2 tree leaves the change completed and applied under rex.applyOn complete (test)"
  - "Hench's v2 completion produces the same tree as update_task_status for the same task (parity test)"
  - "v1 hench completion is unchanged (existing tests pass unedited)"
description: "Found reviewing 6a4bb0bf (run f5d0c83c). Verdict: out-of-scope (hench lane, stack B / roadmap PR 35). Severity high.\n\nFailure scenario: inside a hench run, update_task_status { status: \"completed\" } is held (cli/completion-hold.ts) and returns before the v2 path that 6a4bb0bf added. Hench then applies the completion itself after its test gate through packages/hench/src/tools/rex.ts (~line 184–199): computeTimestampUpdates + store.updateItem on the projected document, then reconcileAutoCompletions over projected items. On a v2 tree that completes the change through the projection without running completeTask/completeChange: no rex.applyOn handling, so the change's amendments are never applied, the #368 in_progress rule and the needsPlacement hold follow v1 semantics, and CLI/MCP and hench disagree.\n\nReachability: every `ndx work` run on a v2 tree that completes the last task of a change.\n\nOptions:\n1. Recommended: in stack B, hench calls the v2 completion exported by rex (completeV2Work / completeWork through its rex gateway, once \"rex exports the v2 runtime\" lands) when the store is the change-layer store. Cost: one gateway export plus a branch in tools/rex.ts and tests.\n2. Have the held completion be applied by spawning `rex update --status=completed`, which now routes through the v2 path. Simpler, but loses typed results."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-12T08:53:40.934Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
