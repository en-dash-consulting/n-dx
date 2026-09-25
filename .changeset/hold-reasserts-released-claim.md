---
"@n-dx/hench": patch
---

The uncommitted-work refusal's claim hold survives a claim that is already gone

When the completion gate refuses a task because its work is uncommitted,
hench holds the cross-worktree claim so no other worktree redoes the work.
But on the CLI provider the spawned agent could release the claim first: its
own `update_task_status` (completed) through the rex MCP server released the
claim for every completing status — so by refusal time the claim was already
gone, the hold silently found nothing to hold, and the task went straight back
on the market (observed live: run 01c990df, 2026-09-23). Inside a run the
agent's completion write is now recorded on the claim instead of releasing it,
so the normal path keeps the claim; as a fallback for a claim lost any other
way (an agent whose `rex` predates this release, for one), `TaskClaims.hold`
now re-asserts the claim when the store no longer carries it — safe, because the uncommitted
work is in this worktree — and leaves a claim another worktree took meanwhile
untouched. A hold that cannot stick is reported instead of passing silently,
and integration tests now drive `finalizeRun`'s refusal path against a real
claims store, including the mid-run-release scenario.
