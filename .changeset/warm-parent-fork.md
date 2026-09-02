---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Fork task spawns from a warm orientation session instead of cold-starting
every task.

A cold task spawn spends its first turns rediscovering the repo — layout,
build and test commands, conventions — and pays that again on every retry and
every task in a `--loop`. Hench now runs that once, in a read-only orientation
session, and spawns each task as a fork of it (`--resume <parent>
--fork-session`), so tasks arrive already oriented and every fork presents the
same prefix.

The orientation prompt is deliberately task-free: mention one task in it and
every fork gets a different prefix, and the first task's framing leaks into
the rest of the loop. Orientation is also read-only three times over — stated
in the system prompt, restated in the task prompt, and spawned in `plan` mode
— because that transcript is inherited by everything downstream.

`cliLoop` runs once per task, so the cache, not loop plumbing, is what makes
orientation happen once per loop; it also persists across separate `ndx work`
invocations within the TTL. `ndx work --fresh` discards it, applied once at
the start of a run rather than per task, so a loop re-orients exactly once.

Two failure modes are handled deliberately. Orientation never fails a run: a
spawn that errors, throws, or reports no session id simply yields no parent
and tasks spawn cold. And because a cached parent is validated against its own
metadata rather than the vendor's session store, a parent the CLI has since
forgotten would otherwise fail every task in the loop — so the first failed
fork drops the cache, disables forking for the rest of the run, and re-spawns
cold without consuming retry budget.

Runs record `parentSessionId` when they forked, making the saving auditable.
Forking requires a CLI that resumes by session id, so other vendors and
`provider=api` continue to spawn cold.
