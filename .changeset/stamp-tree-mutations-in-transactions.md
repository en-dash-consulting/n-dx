---
"@n-dx/rex": patch
"@n-dx/web": patch
---

Stamp `lastModified` on tree mutations made inside `store.withTransaction`.

Only the single-item store methods (`addItem`/`updateItem`/`removeItem`)
stamped. Every batch write mutates the tree directly inside a transaction and
so bypassed them: the dashboard's bulk update and merge routes, the Ask panel's
apply-refinements, and the CLI restructurers. The item was written to disk
looking untouched.

That is silent in both directions. `isModifiedSinceSync` asks whether
`lastModified > lastSyncedAt`, so a previously-synced item whose stamp never
advanced is skipped on push; `resolveConflicts` then does last-write-wins on
local versus remote time, and with the local time stale the next
`sync_with_remote` overwrites the local change with the remote's value. Nothing
reports either half. Reachable on any project configured with a remote adapter.

The stamp now belongs to the transaction rather than to each caller —
`FileStore.withTransaction` and `FolderTreeStore.withTransaction` signature the
tree before running the callback and stamp whatever changed, via
`snapshotItemContent` / `stampChangedItems` in `core/sync.ts`.

Deliberate details:

- **Changed, not merely present.** `migrate-slugs` and `reshape` each open an
  empty transaction purely to force a rewrite; stamping unconditionally would
  mark every item in the PRD modified and queue the whole tree for push.
- **A parent whose child list changed counts as changed**, which is what
  `removeItem` already did by hand for exactly this reason.
- **A stamp the item arrived with is kept.** `analyze.ts` stamps its accepted
  items before opening its transaction, deliberately; only an item that is new
  to the tree *and* unstamped gets one here.
- **Sync bookkeeping is excluded from the signature** (`lastModified`,
  `lastModifiedBy`, `lastSyncedAt`, `remoteId`) — including any of them would
  make a stamp, or a recorded sync, look like a further modification.
- **The actor is resolved before the lock is taken.** `resolveActor` shells out
  to `git config` on first call; doing that inside the locked span puts a
  subprocess between every other writer and the PRD.

The remote adapters keep their own lock-free `withTransaction` unchanged: they
push to systems where these timestamps mean something different.
