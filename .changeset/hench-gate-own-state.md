---
"@n-dx/hench": patch
---

Stop an autonomous run blocking on the lock file it just created itself.

`ndx work --auto` refused to start with "Refusing to start an autonomous run
with 1 uncommitted file(s), 0 line(s) changed in the working tree", and the tree
read clean to anyone who checked afterwards — so the report looked
unreproducible. The file was `.hench/locks/`, which hench creates the instant a
run starts, before any real work happens, and removes on exit. The run blocked
on its own bookkeeping, then erased the evidence.

`hench init` already gitignores those paths, which covers a freshly initialised
project. It does not cover a project initialised before that landed, or one
whose `.gitignore` was edited, so the gate no longer depends on the ignore rule:
paths hench wrote for itself are excluded from the dirty check directly.
`.hench/config.json` is deliberately not in that set — it is meant to be
committed, so an edit to it still stops an autonomous run.

The path list now lives in one place (`HENCH_RUNTIME_ARTIFACTS`) rather than
being written out separately by `hench init` and the gate, which are required to
agree.

The dirty check also now passes `--untracked-files=all`. Without it git collapses
a wholly-untracked directory into one entry — a fresh project reports
`?? .hench/`, never `?? .hench/locks/` — so the exclusion could not see what was
inside and the run blocked anyway. It also makes the count honest: a directory of
forty new files was previously reported as "1 uncommitted file(s)".

The same exclusion applies to the post-run rollback check, where hench's own lock
and run files should likewise never make a rollback look necessary.
