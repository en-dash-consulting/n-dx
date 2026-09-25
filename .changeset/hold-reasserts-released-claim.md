---
"@n-dx/hench": patch
---

The uncommitted-work refusal's claim hold survives the agent's own status write

When the completion gate refuses a task because its work is uncommitted,
hench holds the cross-worktree claim so no other worktree redoes the work.
But on the CLI provider the spawned agent calls `rex_update_status(completed)`
itself through the rex MCP server, whose handler releases the claim for every
completing status — so by refusal time the claim was already gone, the hold
silently found nothing to hold, and the task went straight back on the market
(observed live: run 01c990df, 2026-09-23). `TaskClaims.hold` now re-asserts
the claim when the store no longer carries it — safe, because the uncommitted
work is in this worktree — and leaves a claim another worktree took meanwhile
untouched. A hold that cannot stick is reported instead of passing silently,
and integration tests now drive `finalizeRun`'s refusal path against a real
claims store, including the mid-run-release scenario.
