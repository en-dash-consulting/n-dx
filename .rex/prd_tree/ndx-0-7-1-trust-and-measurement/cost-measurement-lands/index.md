---
id: "2664868a-09ea-4567-bc82-78e95a3cc849"
level: "feature"
title: "Cost measurement lands"
status: "pending"
priority: "high"
tags:
  - "0.7.1"
  - "cost-measurement"
source: "caos work management: feature ndx 0.7.1 - Cost measurement lands"
acceptanceCriteria:
  - "PR #353 is merged and the full suite is green."
  - "Dashboard token usage and ndx usage show per-model splits that agree for the same runs, and the ndx usage run count matches the run records."
  - "prompt-census run from a worktree records the real commit."
  - "A comparable batch has run on 0.7.1 and its total, split by token class and model, is recorded next to the baseline."
  - "The 0.7.1 release note explains the reported-cost change."
description: "The prompt-caching, summarizing-prune and primer-seeded-orientation work (PR #353) is built and green but has never run against a live provider, and three reporting defects hide its effect: the dashboard prices every model at one rate, ndx usage counts hench turns as calls (1,851 runs reported against a package line of 10), and prompt-census stamps 'commit: unknown' when run from a worktree. Rebase and merge #353, fix the three defects, run a batch of ndx work tasks comparable to the 10-run, $247.53 pre-optimization baseline on the published build, and record the comparison with all four token classes (input, output, cache write, cache read). Per-model pricing raises reported costs about 35%; the release note must say so. Related rex tasks: 24cea926, 34c7a43d, 02380e14.\n\nGoal: There is a measured before-and-after number for the optimization work, and every cost surface prices runs per model."
lastModified: "2026-09-21T17:24:08.632Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Count hench runs, not turns, in ndx usage](./count-hench-runs-not-turns-in-ndx-usage.md) | completed |
| [Make prompt-census record the real commit when run from a worktree](./make-prompt-census-record-the-real.md) | completed |
| [Price dashboard token usage per model and show the split](./price-dashboard-token-usage-per-model.md) | completed |
| [Primer freshness check rejects a still-valid primer after any analysis that made no LLM call](./primer-freshness-check-rejects-a-still.md) | completed |
| [Rebase PR #353 onto main and merge it](./rebase-pr-353-onto-main-and-merge-it.md) | completed |
| [Run the post-merge measurement batch and record the comparison with the baseline](./run-the-post-merge-measurement-batch.md) | pending |
| [Sync the web rex-gateway contract test list with estimateCostFromTotals](./sync-the-web-rex-gateway-contract-test.md) | completed |
| [Write the 0.7.1 release note explaining the reported-cost change](./write-the-0-7-1-release-note.md) | in_progress |
