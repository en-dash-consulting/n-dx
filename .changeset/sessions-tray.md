---
"@n-dx/web": patch
---

Add the Sessions tray: a third bottom-right pill — "3 worktrees · 1 running" — expanding into a row per worktree with its name (anchor starred), branch, dirty count, and either the run in flight with a ticking elapsed time or the last one with its status, linking through to that run in the Runs view. Read-only: it does not switch the dashboard's workspace. Hidden outside a git repository and in a single-worktree one.

`GET /api/worktrees` gains `runs.latest` — the running run that started most recently, else the most recently finished one — with the id, status, task title and timestamps the tray shows.

Move `formatSince` from the Workspaces view to `viewer/utils/format.ts`, now that the tray is its second consumer.
