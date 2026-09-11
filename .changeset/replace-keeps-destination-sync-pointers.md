---
"@n-dx/rex": patch
---

Stop `rex import-bundle --replace` clearing the destination's own remote pointers.

`remoteId` and `lastSyncedAt` say which record in *this* project's remote an item
maps to, and when it was last reconciled. A bundle cannot know either — export
strips them so one project's pointers never reach another — so their absence
from a bundle is silence, not an instruction to clear.

`--replace` read it as an instruction, and installed items with neither over
local items that had both. Two consequences on the same-project
export → edit → replace round trip the feature documents. Every item lost
`lastSyncedAt`, so `isModifiedSinceSync` went true tree-wide and the next
`rex sync` would push the whole tree and win every field conflict against remote
edits made since. And `remove-feature.ts` collects its "this item is synced,
warn before deleting" list by `remoteId`, so `rex remove` silently stopped
offering to clean up the remote records. Inert without a remote adapter
configured, since the fields are never set there.

A replace now carries the destination's pointers onto the ids that survive it.
An id the destination has never seen gets none, which also clears anything a
hand-authored bundle tried to smuggle in — `parseBundle` already stripped those,
and `mergeBundle` now holds the same guarantee on its own terms rather than by
its caller's good behaviour.

The export-side guarantee is unchanged: a bundle still carries no remote
pointers at all.
