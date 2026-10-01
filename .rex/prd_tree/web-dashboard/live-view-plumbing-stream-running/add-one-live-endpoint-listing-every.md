---
id: "ee6d1469-e731-4c4e-868b-ba2684c11c46"
level: "task"
title: "Add one live endpoint listing every running run and job across the repository's worktrees"
status: "pending"
priority: "high"
tags:
  - "live"
  - "web-server"
blockedBy:
  - "9b20d881-bd59-495f-8a92-abd2a6f3abad"
  - "a8335123-473d-41cf-9be4-3bce15ee13be"
acceptanceCriteria:
  - "One request returns everything the Live overview needs; the response lists runs from every worktree of the repository, not only the one being viewed."
  - "Counts match the existing bottom-bar stuck-run indicator and the worktrees pill for the same moment."
  - "The endpoint stays under 100 ms with 25 worktrees by reading cached sources."
  - "A WebSocket frame fires when a run or job starts, finishes or goes stale."
description: "The Live tab's badge, hover peek, overview and running-now switcher all read one list. Add `GET /api/live` (and a WebSocket frame when it changes) that returns: running hench runs from every worktree of the repository (task id and title, epic chain, branch, worktree, started at, turns, tokens, model, loop position, started-from dashboard or terminal, heartbeat age, stale flag using the existing 5-minute threshold, last progress line); running long jobs from the active-operations sources (`packages/web/src/viewer/hooks/use-active-operations.ts` lists sv analyze, rex analyze, recommend, reshape, ci, refresh, self-heal) with their progress where available; the queue and loop chain (next tasks and queued execute requests); a machine strip (agent slots in use from the concurrency status, free memory and floor, configured vendor and model, worktree count and how many have a live run, spend today and in flight); and runs finished in the last hour. Reuse the existing worktree, concurrency, memory and status sources rather than re-deriving them."
lastModified: "2026-10-01T00:21:06.587Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
