---
"@n-dx/rex": patch
---

Tighten the v2 validation rules before the schema freeze. A change is applied only when `appliedAt` is set, and a completed but unapplied change stays open (`isAppliedChange` and `isOpenChange` are now exported). Inbox changes (`needsPlacement`) may have no target yet but cannot close unplaced. New errors cover a change that is both a fix and a spike, a `type` on a modified or removed amendment, duplicate check results, ids, display ids or aliases claimed by two nodes, and references that name no node. A check result for a requirement the node no longer has is a warning. `indexTree` is exported, resolves ids before aliases, and can index retired nodes with `includeTombstones`. v2 is still not wired to the store.
