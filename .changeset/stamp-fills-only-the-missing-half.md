---
"@n-dx/rex": patch
---

Stop an attribution-only item being permanently invisible to remote sync.

`stampChangedItems` treated `lastModifiedBy` as a complete stamp and skipped the
item, which protected the original author — a bundle import carries attribution
for items whose source project never recorded a timestamp, and overwriting it
would destroy exactly the provenance a transport artifact exists to preserve.
But it bought that at the cost of the other half: `isModifiedSinceSync` opens
with `if (!meta.lastModified) return false`, so such an item was never
considered modified, and it could not acquire a timestamp later either, because
from the next transaction on the snapshot records it as pre-existing and
unchanged. The item was never pushed, and the next pull overwrote its content
with the remote's value in silence.

The two halves are now filled independently: a new item always leaves with a
`lastModified`, and its `lastModifiedBy` is set only when it brought none. An
item that arrives with a timestamp but no author is left alone — it is already
visible to sync, and the actor running the transaction did not write it, so
recording them would be a fabricated attribution rather than a default.

This closes the general case behind a defect previously fixed only for bundle
import. `stampChangedItems` runs inside every `withTransaction` on both store
adapters, so any other path inserting an attribution-only item — an MCP
`add_item`, a hand-edited `index.md` picked up by a later transaction — hit the
same silent loss. Bundle import still defaults the timestamp to the bundle's
`exportedAt`, which is a more honest value than "now" and is left untouched
here.
