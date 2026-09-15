---
id: "eb095228-c50c-40a9-ae12-ad62da7b2a32"
level: "task"
title: "Hench Runs view aggregates .hench/runs across worktrees with a worktree badge"
status: "pending"
priority: "high"
tags:
  - "pr-05"
  - "web"
blockedBy:
  - "271a28ee-10dc-41d3-9e35-5f10571cbcfe"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Runs from a second worktree appear in the served dashboard's Runs view with the correct worktree chip."
  - "A new run file in another worktree triggers a live update without restarting the server."
  - "Default (no scope) behaviour and existing tests unchanged."
description: "Server: GET /api/hench/runs gains an optional ?scope=repo that merges run files from every worktree's .hench/runs (default stays the served directory for compatibility) and annotates each run with worktree { name (basename), path, branch }. Register one lazy fs.watch per worktree runs directory (mirroring registerHenchWatcher in start.ts) so hench:run-changed still fires. Viewer: hench-runs.ts requests scope=repo, shows a small worktree chip on each run card (mono, existing .chip style), and lets the user filter by worktree. The aggregator cache in routes-hench.ts is already keyed by runsDir, so per-worktree aggregation reuses it."
lastModified: "2026-09-10T20:11:59.619Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
