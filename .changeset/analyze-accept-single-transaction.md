---
"@n-dx/rex": patch
---

Insert an `analyze --accept` batch in one transaction, so it stops failing its own stale-save guard.

Acceptance called `store.addItem` once per item, so accepting N items ran N
transactions and serialized the whole folder tree N times. Every intermediate
shape reached disk — and one of them is destructive to clean up. An epic
inserted before its first feature has no children, so the serializer writes it
as the leaf `general.md`; the transaction that adds that feature must then
DELETE the leaf to promote the epic to `general/index.md`.

The stale-save guard weighs every such deletion against the transaction's own
load time, with a 2 ms tolerance. Measured on Windows, the leaf's mtime lands
just 0.57–2.04 ms before the next transaction's load — inside the window, but
with almost nothing to spare. Under the I/O pressure of the full monorepo suite
the write timestamp drifts past it, and the accept aborts with

    Stale-save guard: this save would delete 1 item written after the document
    being saved was loaded

naming `prd_tree/general.md` and warning that another writer's work was about to
be destroyed. It was its own, one transaction earlier. This reproduced 2/2
through `scripts/run-all-tests.mjs` and passed 2/2 with the rex suite alone,
so it presented as flake rather than as a bug in the accept path — that runner's
header already refers to "rex's load-sensitive tests".

Proposals are now built into fully-nested epics up front and pushed in a single
`store.withTransaction`, which is what the guard's own error message advises.
One write emits the final shape, so the intermediate leaf is never created and
there is no deletion to weigh. Verified with a filesystem watcher over a real
accept: only `general/`, `general/index.md` and the feature file are touched.
Item stamping (`withSelfHealTag` then `stampModified`) is preserved per item and
now happens outside the lock, since resolving the actor can shell out to git.

This is the write path the surrounding "move file lock to saveDocument" work
missed — it converted `reorganize`, `prune` and `reshape`, but not
`analyze --accept`. Accepted counts, batch-record output and the
`analyze_accept` execution-log entry are unchanged.
