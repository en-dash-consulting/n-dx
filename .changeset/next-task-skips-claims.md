---
"@n-dx/web": patch
---

The dashboard's next-task suggestion skips tasks other worktrees hold

`GET /api/rex/next` and the dashboard's Up Next card (`GET /api/rex/dashboard`) suggested the
highest-priority task without consulting the cross-worktree claims store,
while the Execute button refuses a claimed task with 409 — so the dashboard
could recommend exactly the task it would then refuse to start. Both reads
now exclude foreign live claims for the request's workspace — the same set
Execute's check consults — so the suggestion is always a task Execute will
accept. When a higher-priority task was passed over because another worktree
holds it, the response says which task and which worktree
(`skipped`/`nextTaskSkipped`), and the Up Next card shows it: `"<task>" is
claimed by <worktree> — showing the next unclaimed task`.
