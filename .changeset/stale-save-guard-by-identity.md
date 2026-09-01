---
"@n-dx/rex": patch
---

Stop the stale-save guard refusing legitimate PRD writes

The guard that protects a concurrent writer's items from being deleted by a
stale save was rejecting ordinary saves — measured at **25 failures in 40**
load-mutate-save cycles, surfacing as intermittent failures in different
`FileStore` tests from run to run.

It compared each deletion candidate's `stat().mtimeMs` against a `Date.now()`
taken at load, allowing 2 ms for "fractional milliseconds". Those two values do
not come from the same clock: Node reads a high-precision system time, while
the filesystem stamps writes from the system timer tick (~15.6 ms on Windows).
Measured against a file written strictly *before* the load, the delta scattered
from −8 ms to +6 ms — so a file the load definitely saw regularly read as newer
than the load. No tolerance value fixes that; widening it past one timer tick
would blind the guard to the concurrent writes it exists to catch.

The guard now works on item identity instead. Callers pass `knownItemIds` — the
ids present in the document they loaded — and a deletion candidate is refused
only when it carries an id that document never contained. That answers the real
question directly: not "was this written recently?" but "did we know about
this?". It needs no clock, so it cannot drift with platform or filesystem.

Behaviour is otherwise unchanged: directories are still checked recursively, an
empty set still means "never loaded, delete nothing identifiable",
`allowBulkDelete` still overrides, and omitting the option still selects the
legacy delete-freely path. An entry with no readable `id` frontmatter is not
reported — nothing the store writes lacks one, so it is not the concurrent work
being protected.

Verified across 20 consecutive isolated runs of the previously-flaking test with
zero failures, plus the existing guard tests rewritten to the new mechanism —
which no longer need `sleep()` calls to separate a load from a write.
