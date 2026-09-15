---
"@n-dx/rex": patch
---

Add a cross-worktree task claim store in the git common directory.

Nothing currently stops two worktrees of one repository from picking the same
task. `get_next_task` reads the branch's own `.rex/prd_tree/`, hench's process
locks live in each checkout's `.hench/locks`, and the dashboard only ever sees
its own children — so three separate mechanisms each look at one checkout and
none of them can see a sibling.

`openClaimsStore(projectDir)` gives them a shared fact to consult. The claims
live at `<git-common-dir>/ndx/claims.json`, which every linked worktree of a
repository resolves to the same path and which git can never track, being inside
`.git`. Writes go through the existing `file-lock` advisory lock and
`atomic-write`, so two processes claiming the same task at the same moment yield
exactly one winner.

A claim is live only while its owning process is running *and* its expiry is in
the future (default four hours). The PID check is what frees a task within
seconds of a run being killed or the machine rebooting; the TTL is the backstop
for a process that is alive but has long since wandered off the task, and for
the case where the PID means nothing because the claim was written elsewhere.
Either failing drops the claim on the next write, so an abandoned claim can
never become a permanent outage for a task. `release` is compare-and-delete on
the owning pid and worktree, mirroring the file lock's ownership token, so a
late release cannot evict whoever took the task afterwards.

Outside a git repository there is no shared location and no second worktree to
collide with, so the store is a no-op: nothing is claimed, every claim succeeds,
and behaviour is unchanged.

This is the storage layer only — task selection and the dashboard do not consult
it yet.

`acquireLock` also takes an optional `label` now, so the claims lock's timeout
message names the task claim rather than the PRD. Callers that pass nothing are
unaffected.
