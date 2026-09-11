---
"@n-dx/rex": patch
---

Stop PRD bundles carrying the source project's remote-sync pointers.

`lastSyncedAt` and `remoteId` bind an item to the *source* project's remote.
`sync.ts` already treats both as non-content, but nothing stripped them on the
way into a bundle, so they travelled to the destination.

Export from project A, synced to A's Notion workspace, then import into project
B: the items arrived with A's `lastSyncedAt` at or after their `lastModified`,
so `isModifiedSinceSync` read them as unmodified and B's first bidirectional
sync let the remote win, overwriting the freshly imported content in silence.
The stale `remoteId` values pointed at A's pages, so B's sync wrote into another
project's remote records.

`buildBundle` now strips both fields recursively from the cloned items.
Attribution is unaffected — `lastModified` and `lastModifiedBy` are content and
still travel — and provenance belongs in `exportedFrom`, not in per-item remote
pointers. The strip runs on the bundle's own deep clone, so the source document
is left untouched.
