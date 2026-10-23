---
id: "5e38e56b-d2bf-47b6-af0a-92a0c877bdf1"
type: "change"
title: "/api/live re-parses the PRD index on a 10-second timer instead of when the file changes"
slug: "api-live-re-parses-the-prd-index-on-a"
intent: "Failure: `prdIndexFor` in `packages/web/src/server/routes-live.ts:212,269-283` expires on a 10 s timer, not on file mtime, and is called for the served worktree's queue and for every worktree with a running or recent run. This repository's `.rex/.cache/prd.json` is 3.4 MB, so each parse plus `walkTree` costs tens of milliseconds synchronously on the 2 s monitor tick; a few busy worktrees exceed the 100 ms budget every 10 s. The 25-worktree test uses tiny PRDs and counts only run-file parses. Related, unverified: `loadPRDSync` reads `.rex/.cache/prd.json`, never `prd_tree/`, so a worktree without a live workspace context gets empty chains, or stale ones from an old cache file.\n\nReachability: every /api/live request on a large PRD. Verdict: should-fix (severity medium, performance).\n\nOptions:\n- Recommended: key the cache on the cache file's stat mtime and size, as `digestRunFile` already does. Small. Check the `prd_tree/` question while there."
acceptanceCriteria:
  - "The PRD index for a worktree is re-parsed only when its source file's mtime or size changes (unit test counting parses across ticks)."
  - "A worktree without a cached prd.json gets its chain from the folder tree or reports none, never a stale chain (test or documented decision)."
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "live"
source: "ndx-adversarial-review"
---
