---
"@n-dx/hench": patch
"@n-dx/core": patch
---

Bound the spawns one task can make, and retry by resuming the failed session
rather than cold-restarting it.

**Breaking-ish behaviour change:** plan-mode re-spawns now consume the retry
budget. Previously they were a separate per-attempt allowance, so four retries
against up to three plan re-spawns each could reach twelve cold spawns for a
single task — every one re-paying the harness prompt, the project
instructions, and the repo re-exploration. Making them additive means a task
that spends its budget entering plan mode gets correspondingly fewer failure
retries than it did before.

A hard ceiling sits on top of the retry budget, defaulting to 8 and
configurable via `hench.maxSpawnsPerTask`. The two layers are not redundant:
some re-spawn paths deliberately *avoid* charging the retry budget, because
nothing was learned about the task — a plan-mode interception, the
stale-parent fork fallback. The ceiling counts every spawn regardless of why
it happened, so no future re-spawn path can reintroduce unbounded
multiplication by simply not asking. It is checked before spawning, so it
refuses to spend rather than reporting that the spending already happened, and
hitting it fails the task with the full breakdown.

Transient failures on the Claude CLI now retry by resuming the failed session
— a plain resume, not a fork, since branching off the failure would leave the
retry without the transcript it exists to continue. The cold-restart retry
notice is suppressed on those retries: a resumed session *was* the previous
attempt, so telling it that files from a prior attempt still exist and to check
the current state before redoing work restates what it just did, and grows the
prompt on every retry. Vendors with no resume on this path keep cold retries
and keep the notice.

Runs now record `spawnCount` and `spawnBreakdown`, so `ndx usage` can report
retry overhead — a task that took four spawns to succeed reads differently
from one that took one, and six plan re-spawns call for a different fix than
six failure retries.
