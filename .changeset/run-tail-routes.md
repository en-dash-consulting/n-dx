---
"@n-dx/web": patch
---

The dashboard server can now tail a hench run while it runs. `GET /api/hench/runs/:id/log?from=<byte offset>` returns the run log from a cursor and `GET /api/hench/runs/:id/events?after=<seq>` returns the progress events after one. Each response carries the next cursor. The run can be in any worktree of the repository. Files are served only from `.run-logs/` or `.hench/runs/` of a worktree that `git worktree list` reports; any other path, including a symlink out of those directories, gets a 404. Runs recorded before the incremental log return their end-of-run log. While a client is tailing a running run, the server pushes a workspace-tagged `hench:run-appended` WebSocket frame within about a quarter second of the log or event stream growing.
