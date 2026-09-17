---
"@n-dx/web": patch
---

The dashboard shows cross-worktree task claims. New read-only `GET /api/rex/claims` lists the live claims in the repository's shared store, with each task's title from the served PRD and the claiming worktree. PRD tree rows carry a "claimed · <worktree>" chip ("here" when this checkout holds it), and the Sessions tray lists the tasks each worktree has claimed under its row. Both refresh on the poll tick and on `hench:run-changed`, so a claim appears within one interval and disappears when released.
