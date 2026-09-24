---
"@n-dx/web": patch
---

The dashboard tells a held claim from a live run

A claim kept by a finished run (uncommitted work left in its worktree) looked
identical to a run in progress: `GET /api/rex/claims` omitted the hold
reason, the PRD tree chip said `claimed · <worktree>`, and Execute's 409 said
the task "is being worked on" — sending the operator to look for a process
that ended hours ago. Claims entries now carry `reason` when (and only when)
a claim is held; the chip reads `held · <worktree>` with a tooltip naming the
uncommitted work and `ndx claim release <id>`; and the Execute 409 for a held
task explains the hold and how to free it. A live claim keeps today's wording
everywhere.
