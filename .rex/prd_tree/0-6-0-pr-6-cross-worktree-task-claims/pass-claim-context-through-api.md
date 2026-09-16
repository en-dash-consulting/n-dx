---
id: "25921948-0b6a-4750-bcbf-c90d1d04d220"
level: "task"
title: "Pass claim context through API-provider autoselection"
status: "pending"
priority: "high"
tags:
  - "pr-06"
  - "claims"
  - "hench"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A supported API-provider `ndx work --auto` call passes the project directory into shared brief preparation, so it filters live claims and atomically acquires its chosen task."
  - "Two linked worktrees using the API-provider path cannot both begin the same automatically selected task."
  - "The API-provider regression test fails if project-directory claim context is removed from `agentLoop`."
description: "Severity: high. Verdict: must-fix. In `packages/hench/src/agent/lifecycle/loop.ts`, `agentLoop` calls `prepareBrief` without `projectDir`; in `shared.ts`, both claim filtering and the atomic `claimTask` call are guarded by `options?.projectDir`. Therefore two linked worktrees configured with a supported API provider (for example local or Google) can each run `ndx work --auto`, select the same task, and begin duplicate work. Pass `projectDir` through the API loop exactly as the CLI loop does, then add a two-worktree API-provider regression test. This is small and restores the PR's primary guarantee."
lastModified: "2026-09-16T14:25:09.518Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
