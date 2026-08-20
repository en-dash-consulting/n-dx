---
id: "9c9ae59f-4cf3-4e05-80c9-761c6ec80fdf"
level: "task"
title: "Reconcile the null-hash contract in both run-file change detectors"
status: "pending"
priority: "low"
tags:
  - "pr-329-followup"
  - "web"
  - "hench"
  - "task-usage"
  - "twins"
blockedBy:
  - "377aa1d0-06cb-4fa1-82e9-86dccfeca2a4"
source: "PR #329 review comments 3816985317, 3816985328 (ryrykeith)"
acceptanceCriteria:
  - "The documented null-hash contract matches actual caller behavior in both incremental-task-usage.ts and run-change-detector.ts"
  - "A read failure on a previously-hashed run file does not silently drop that file's tokens from the web aggregate"
  - "Both twins are changed together and the twin parity test still passes"
  - "A test covers the read-failure path for a file that previously had a hash"
description: "PR #329 review follow-up — two unresolved comments on twin implementations:\n- packages/web/src/server/task-usage/incremental-task-usage.ts:344 (`hashFile` doc)\n- packages/hench/src/store/run-change-detector.ts:339 (`hashFile` doc)\n\nBoth docblocks claim a read failure yields null \"which the caller treats as 'no usable hash' rather than as a change\". Neither caller does. In incremental-task-usage.ts the comparison at line 253 is `prev.contentHash !== null && prev.contentHash !== snapshot.contentHash` — it guards the *previous* hash against null but not the new one, so a previously-hashed file whose read now fails compares `\"abc\" !== null` and is reported modified. The web copy then subtracts the file's contribution and re-reads; if that read also fails, `readFileContribution` returns null and the tokens silently drop out of the aggregate until the file changes again. The hench copy only reports the change without mutating an accumulator, so the impact is lower, but the doc is equally wrong.\n\nFix both together — either make the comparison tolerate null on either side (treat \"no usable hash\" as no evidence of change) or delete the sentence and document what actually happens. Fixing one copy alone will turn the twin parity test red."
---
