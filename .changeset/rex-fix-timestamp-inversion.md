---
"@n-dx/rex": patch
---

`rex fix` no longer inverts timestamps when backfilling `startedAt` on completed items (#375). The backfill now derives from the item's own `completedAt` — never the current clock, which produced `startedAt > completedAt` on anything completed before today. Already-inverted pairs are now a detectable, repairable issue (new `inverted_timestamps` fix kind): the repair clamps `startedAt` back to `completedAt`, so trees damaged by the old backfill heal in one `rex fix` run.
