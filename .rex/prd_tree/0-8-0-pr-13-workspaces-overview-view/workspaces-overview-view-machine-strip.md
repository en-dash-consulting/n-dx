---
id: "00669fc3-3e39-446c-826a-ae3c964e83f9"
level: "task"
title: "Workspaces Overview view: machine strip, one card per worktree with live run, PRD delta count and Open / Start working / Stop; new WORKSPACES sidebar section"
status: "pending"
priority: "high"
tags:
  - "pr-13"
  - "web"
blockedBy:
  - "592e5c5f-8007-4fb3-860e-9eb4ee37e760"
  - "8d5f3393-57cf-4d83-8324-108cc4388d24"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Renders for this repo with its worktrees; cards update live when a run in another worktree progresses."
  - "Start working from a card starts the run in that worktree (cwd = worktree) and the card shows it within one broadcast."
  - "Screenshot check in light and dark; accessibility test for the new section and cards (existing a11y test harness)."
description: "New view id \"workspaces\" in src/shared/view-id.ts and view-routing (cross-cutting scope), registered in views/view-registry.ts and sidebar.ts as a WORKSPACES section above SOURCEVISION with one item \"Overview\"; when this section renders, HENCH is collapsed by default (the sidebar's collapsible sections already exist). Machine strip: four stat tiles using .stat-card anatomy (cards.css): agents running (from /api/hench/concurrency across workspaces), memory in use (/api/hench/memory), uncommitted trees, PRD items only on branches (sum of onlyHere from pr13.t1). Cards (grid of 2): worktree name + anchor star or running pulse (active-task-card idioms in hench-runs.css), status badge, branch (mono chip), live run block (task title link, elapsed tabular-nums, turn, model chip, tok/s badge, last stdout line in a mono block) or \"Last run · …\", footer chips: uncommitted count (orange) or clean, \"PRD · N only here / changed here\" (purple), actions: Open workspace (navigates to /w/<key>/prd), Start working (existing StartTaskButton flow against that workspace), Stop (terminate route) when running. Data: /api/worktrees, /api/workspaces/:wt/prd-delta, hench execution status per workspace, live via tagged WS frames. Remove the Sessions pill from PR 5 and reuse its hook. Match tokens exactly; both themes; keyboard accessible."
lastModified: "2026-09-10T20:12:31.504Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
