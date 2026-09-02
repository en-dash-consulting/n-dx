---
"@n-dx/rex": patch
---

Hold the folder-tree lock across `syncFolderTree`, and give both stores one
lock name for the tree.

`syncFolderTree` — run after every PRD mutation, from the CLI and from every
MCP write handler — did an unlocked `loadDocument()` followed by an unlocked
full re-serialize of `.rex/prd_tree/`. Serialization deletes every on-disk
entry absent from the snapshot, so the sync was a read-modify-write racing
whatever writer came next, with two failure modes:

- **Crash.** The read could observe a half-created item directory (an item
  gaining its first child converts a bare `<slug>.md` into a `<slug>/`
  directory), `parseFolderTree` threw ENOENT, and the handler returned
  `isError`. This is the flake behind
  `concurrent-write-lost-update.test.ts > an item inserted while
  update_task_status deletes another survives`, which failed only under CI
  load because the overlap window is timing-dependent.
- **Silent lost update.** The sync passed no `loadedAt`, which disables the
  serializer's stale-save guard, so it would delete a concurrent writer's
  items with no error — the exact hole the surrounding suite exists to pin.

The sync now runs its load and its serialize inside one lock acquisition. That
closes both: it sees the committed tree rather than a transient one, and its
snapshot cannot go stale while it holds the lock (so no `loadedAt` proof is
needed).

Separately, `FileStore` guarded the tree with `tree.lock` while
`FolderTreeStore` used `prd.lock`. Two names for one resource meant a writer
on each store could rewrite `.rex/prd_tree/` simultaneously with neither
seeing the other. Both now derive the path from `prdLockPath()` in
`store/paths.ts`, alongside `PRD_TREE_DIRNAME`.
