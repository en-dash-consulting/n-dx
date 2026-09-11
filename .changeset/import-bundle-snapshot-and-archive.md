---
"@n-dx/rex": patch
---

Make `rex import-bundle` undoable.

`snapshot-guard.ts` states the guarantee it exists to keep: every command that
rewrites `.rex/prd_tree/` snapshots it first, so `rex restore` can always return
the tree to the state it was in before the command ran. Eight commands honoured
it. `import-bundle` did not — and `--replace --yes`, the non-interactive form in
its own help examples, discards every local item. It left no snapshot and no
archive batch, so recovery depended entirely on git, which is no recovery at all
on a project that gitignores `.rex/prd_tree/`.

The import now calls `ensureSnapshot`, inheriting the `--no-snapshot` opt-out
and the fail-closed behaviour on a snapshot error rather than reimplementing
them. The snapshot is taken after any `--replace` confirmation is answered, so a
declined replace does not burn a slot in the retention cap.

`--replace` additionally records the items it discarded to `.rex/archive.json`
under a new `import` source, as `prune` and `reshape` do. Both records are
needed: restoring the snapshot discards whatever the import brought in, while
the archive keeps individual items — but not their placement — after the
snapshot has aged out of the retention cap.

`rex import-bundle --help` documents both the snapshot and `--no-snapshot`.
