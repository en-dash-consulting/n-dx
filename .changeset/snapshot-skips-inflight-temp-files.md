---
"@n-dx/rex": patch
---

PRD tree snapshots no longer abort when another process is mid-write.

`snapshotPRDTree` copies `.rex/prd_tree/` before the PRD lock is taken, so a
concurrent writer can change the tree under it. An atomic writer's
`<file>.<pid>.<uuid>.tmp` that existed when `cp` read the directory and was
renamed away before it stat'd the entry raised `ENOENT`, and the snapshot guard
turned that into a refused command — `rex import-bundle` failing because some
unrelated process had finished a write.

The copy now filters those temp files out of the walk (they are not PRD content
and must never appear in a rollback point), and re-walks the tree if any other
entry vanishes mid-copy, so a save's stale-directory sweep cannot fail a
snapshot either. A persistent error still fails loudly rather than producing an
incomplete rollback point.

The temp-path shape is now built and recognised by one pair of helpers next to
the atomic writer (`atomicWriteTempPath` / `isAtomicWriteTempPath`), replacing
three hand-rolled copies of the same template string.
