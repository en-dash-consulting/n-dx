---
"@n-dx/rex": patch
---

Stop the PRD lock being taken from a process that is still running.

A lock file was treated as stale when its owner was dead **or** when it was
simply older than 30 seconds. The second half is not a safety net — a hung
process and a slow one look identical from the outside, and unlinking a running
writer's lock does not fence that writer off. It admits a second writer into the
critical section beside it, which is a lost update.

This was observed rather than theorised. Two concurrent `rex import-bundle`
processes on a loaded machine both entered the critical section, and the
second's save was rejected by the stale-save guard for deleting an item the
first had written moments earlier. It surfaced as an intermittent
`import-bundle-transaction` failure that passed on every re-run — a healthy
import holds the lock well past 30 seconds when the whole test suite is
competing for the disk.

Liveness now decides on its own: another process's lock is reclaimed only when
that process is gone. The `staleMs` option is removed rather than left in place
doing nothing, since a knob that silently governs nothing is worse than no knob.

The trade is deliberate. A lock whose owner died and whose PID has since been
recycled by an unrelated live process will not be reclaimed automatically, and
writers fail after the existing acquire timeout with an error naming the holding
PID and the path to delete. That is loud, bounded and recoverable; a silently
interleaved write is none of those.
