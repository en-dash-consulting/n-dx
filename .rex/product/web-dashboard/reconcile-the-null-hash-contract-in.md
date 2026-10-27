---
id: "9c9ae59f-4cf3-4e05-80c9-761c6ec80fdf"
type: "capability"
title: "Reconcile the null-hash contract in both run-file change detectors"
slug: "reconcile-the-null-hash-contract-in"
statement: "The web task-usage aggregate keeps a previously hashed run file's tokens when a later read of that file fails."
criteria: [{"id":"c1","text":"If a read of a previously hashed run file fails, the web task-usage aggregator shall keep that file's tokens in the aggregate."}]
tags:
  - "pr-329-followup"
  - "web"
  - "hench"
  - "task-usage"
  - "twins"
source: "PR #329 review comments 3816985317, 3816985328 (ryrykeith)"
priority: "low"
---

PR #329 review follow-up — two unresolved comments on twin implementations:
- packages/web/src/server/task-usage/incremental-task-usage.ts:344 (`hashFile` doc)
- packages/hench/src/store/run-change-detector.ts:339 (`hashFile` doc)

Both docblocks claim a read failure yields null "which the caller treats as 'no usable hash' rather than as a change". Neither caller does. In incremental-task-usage.ts the comparison at line 253 is `prev.contentHash !== null && prev.contentHash !== snapshot.contentHash` — it guards the *previous* hash against null but not the new one, so a previously-hashed file whose read now fails compares `"abc" !== null` and is reported modified. The web copy then subtracts the file's contribution and re-reads; if that read also fails, `readFileContribution` returns null and the tokens silently drop out of the aggregate until the file changes again. The hench copy only reports the change without mutating an accumulator, so the impact is lower, but the doc is equally wrong.

Fix both together — either make the comparison tolerate null on either side (treat "no usable hash" as no evidence of change) or delete the sentence and document what actually happens. Fixing one copy alone will turn the twin parity test red.
