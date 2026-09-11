---
"@n-dx/rex": patch
---

Record a bundle import in the execution log.

`.rex/execution-log.jsonl` is the append-only record of PRD activity, and every
other write path writes to it — add, update, move, remove, prune, reshape,
reorganize, fix, smart-add, sync. `import-bundle` wrote nothing, so after an
import nobody could say where the items came from, who ran it, or whether it was
a merge or a replace: the dashboard's activity view showed a PRD that had
changed size with no cause. It mattered most on `--replace`, the one command that
can discard the whole tree.

A successful import now appends a `bundle_imported` entry carrying the mode, the
added / replaced / collision counts, the bundle's `exportedAt`, and its
`exportedFrom` branch and commit when present. `appendLog` stamps the actor, so
the entry answers who as well as what.

The entry is written after the tree write, so a rejected bundle or a declined
`--replace` leaves the log as silent as it leaves the tree. It is an audit
record, not a third recovery mechanism: the snapshot and the archive batch exist
to get items back, while the log preserves what the resulting tree cannot show.
