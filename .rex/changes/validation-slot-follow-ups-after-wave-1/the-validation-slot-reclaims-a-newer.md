---
id: "51f1f218-d1e0-4a74-8a98-e3b5a1a9d8d7"
type: "task"
title: "The validation slot reclaims a newer protocol version's live holder record as stale"
slug: "the-validation-slot-reclaims-a-newer"
summary: "When two copies of n-dx on one machine disagree on the lock file's format, the older one treats the newer one's lock as abandoned and runs its tests at the same time. The fix makes it respect any lock whose owner is still running."
description: "Verdict: should-fix (adversarial review of ed2f3d51). Severity low: no failure today, because only protocol version 1 exists.\n\nScenario: two worktrees run different n-dx builds, for example the global ndx-runner and a fresh worktree build. A later build writes `holder.json` with `version: 2`, or with a field v1 rejects. In `packages/hench/src/process/validation-slot.ts`, `parseValidationSlotHolder` returns null for that record. `acquireValidationSlot` treats null as stale (rule 5) and calls `reclaimStale`, which deletes the live holder's record and takes the slot. Two validations then run at once, which is exactly what the slot exists to prevent. The same holds for the `scripts/lib` reimplementation PR 3 adds.\n\nReachability: version skew across worktrees on one host is the normal state during development of this repo. It becomes reachable as soon as any protocol change ships.\n\nOptions:\n- (A, recommended) An unparseable record that still carries a positive integer `pid` is stale only when that pid is dead and its `bootedAt` (if it is a number) matches this boot. Only a record that is not JSON, or has no pid, is reclaimed outright. Cost: a few lines in each implementation plus a test. Risk: none for v1.\n- (B) Never reclaim an unknown-version record; report it and wait. Cost: smaller. Risk: a crashed newer holder blocks an older build until the operator deletes the file.\n\nDo this before PR 3 copies the protocol into scripts/lib, so both implementations change once."
acceptanceCriteria:
  - "A holder.json with version 2 (or an unknown field shape) whose pid is alive is waited on, not reclaimed; a test in packages/hench/tests/unit/process/validation-slot.test.ts covers it"
  - "A holder.json with an unknown version whose pid is dead is still reclaimed"
  - "The module header's rule 5 states how a record of an unknown version is treated"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "validation-gate"
  - "pr-2-host-slot"
source: "ndx-adversarial-review"
---
