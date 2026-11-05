---
id: "c9a0e430-c671-451b-8188-7454c936499f"
type: "task"
title: "Cross-worktree diffs for source conflicts are cached by base and branch commit"
slug: "cross-worktree-diffs-for-source"
description: "Review finding F3 (https://github.com/en-dash-consulting/n-dx/pull/930#discussion_r4469226257). readOtherWorktrees in packages/web/src/server/branch-health/collect.ts runs git diff --name-only <base>...refs/heads/<branch> for every other worktree on each card's request; GIT_CONCURRENCY 8 is per request and nothing is shared, so a board open with W worktrees runs up to W squared diffs at up to 8W concurrent git processes (Hal measured 48.9s for 33 worktrees). Take option 1: memoise each diff in a module-level map keyed by the base commit and branch tip commit, bounded in size."
acceptanceCriteria:
  - "Each diff result is cached module-wide by (base commit, branch tip commit); two requests over the same worktrees run each distinct diff once (tested by counting git calls)"
  - "A moved base or branch tip gives a new key, so a stale result is never served (tested)"
  - "The cache is bounded (a size cap with oldest-first eviction), tested"
  - "otherWorktrees results are unchanged (the existing other-worktree tests pass)"
priority: "medium"
---
