---
id: "b1dd0bde-32a5-418c-a046-917e7d407181"
level: "task"
title: "Add tail routes and WebSocket frames for a running hench run's log and events"
status: "in_progress"
priority: "high"
tags:
  - "live"
  - "web-server"
blockedBy:
  - "2b3d4191-e2ca-4d64-9944-c4e05734f5fc"
  - "dc5bae73-cdb5-4b87-8d03-d59dfc7aa202"
startedAt: "2026-10-01T03:32:21.363Z"
acceptanceCriteria:
  - "A client can tail a running run's log and events from any cursor and receives new content within 1 second of it being written."
  - "Runs in other worktrees of the repository can be tailed; paths outside the allowed directories are refused with 404."
  - "Completed runs and runs recorded before this change return their full log."
  - "Route and path-confinement tests cover both."
description: "Serve the incremental run log and the progress event stream to the viewer. Add `GET /api/hench/runs/:id/log?from=<byte offset>` and `GET /api/hench/runs/:id/events?after=<seq>` in `packages/web/src/server/routes-hench.ts`, each returning the new content plus the next cursor, and a WebSocket frame announcing appended content for runs that a client is watching. Resolve the files from the run record's recorded paths and its `worktreeRoot`, so a run in another worktree of the same repository can be tailed; refuse any path outside `.run-logs/` and `.hench/runs/` of a registered worktree. Frames carry the workspace so clients filter them the same way as other workspace-tagged frames. Fall back to the end-of-run log for runs written before the incremental log existed."
lastModified: "2026-10-01T03:32:36.683Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
