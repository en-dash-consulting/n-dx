---
id: "2b63e883-9c1f-4d9d-b779-12cb8a47b110"
level: "task"
title: "Build the Live overview page with machine strip, running cards, worktrees, queue and an idle state"
status: "completed"
priority: "high"
tags:
  - "live"
  - "web-viewer"
blockedBy:
  - "ee6d1469-e731-4c4e-868b-ba2684c11c46"
  - "dfb31a58-442b-4ee2-bbff-d2b0b0e58419"
startedAt: "2026-10-01T05:19:26.813Z"
completedAt: "2026-10-01T05:19:26.813Z"
endedAt: "2026-10-01T05:19:26.813Z"
acceptanceCriteria:
  - "Every card opens its item's own Live page; long jobs other than analyze show their last output line."
  - "Stuck runs appear in Needs attention, not in Running now, and Mark stuck uses the existing route."
  - "The idle state appears when the live endpoint reports nothing running, with working Start working and Run analysis actions."
  - "The page updates from WebSocket frames without polling faster than the existing status cadence, and renders at 375 px wide without horizontal scroll."
description: "New view at `/live` fed by the live endpoint and its WebSocket frame. From top: breadcrumb; title with connection state and \"updated N s ago\", Status check and Stop all; a machine strip (agent slots used and queued, running jobs, free memory against the floor, configured vendor and model with credential state, worktree count and how many have a live run, spend today and in flight); \"Needs attention\" rows for stuck runs with Open and Mark stuck (existing `POST /api/hench/runs/:id/mark-stuck`); \"Running now\" cards, newest first, mixing hench tasks (product tile, title, epic chain, branch, model, run n of m, turn, tokens, criteria met as a bar, last progress line) and long jobs (sourcevision analyze shows a six-segment phase bar and its current pass); a side column with the loop chain and queue (Pause loop after current), a by-worktree list (idle worktrees collapsed into \"N more idle\") and runs finished in the last hour linking to Work's run history. With nothing running, show an idle state: machine strip in brief, \"Start the next task\" with Start working, and \"Refresh the analysis\" with fast and deep options and the age of the current analysis."
lastModified: "2026-10-01T05:19:27.201Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
