---
id: "bebe402c-225d-4069-bf4a-f44800a1948f"
type: "task"
title: "The queue planner counts live runs in every worktree of the repository, not only its own"
slug: "the-queue-planner-counts-live-runs-in"
description: "ndx work --plan-queue reads activeRuns with countActiveLocksReadOnly(henchDir) (packages/hench/src/process/limiter.ts), which counts only this worktree hench locks, the same scope the hench run limiter enforces. An operator running lanes in several worktrees of one repository on one machine then gets more lanes than free slots: on 2026-10-28 the plan in one worktree said 0 active of 3 while a run was live in another worktree. Count live locks across every worktree that git worktree list --porcelain names for this repository, resolving each worktree hench dir with resolveLayout (never a hand-spelled .hench path), and report the split. The Live server already counts live runs across worktrees (packages/web/src/server/routes-live.ts, run-liveness.ts), and Ready next gets the plan from this CLI, so it inherits the fix. The planner stays read-only. The hench run limiter itself is unchanged."
acceptanceCriteria:
  - "activeRuns counts live run locks in every worktree that git worktree list names for this repository, this one included (test with two worktrees, one holding a live lock)"
  - "The JSON adds activeRunsByWorktree [{path, runs}] and the summary says how many live runs are in other worktrees"
  - "The plan stays write-free in every worktree: no directory or lock is created or removed (the no-write test covers a sibling worktree)"
  - "Outside a git repository, or when git fails, it falls back to this worktree count and says so in the summary"
  - "The hench run limiter keeps its per-worktree scope"
priority: "medium"
source: "dogfood"
---
