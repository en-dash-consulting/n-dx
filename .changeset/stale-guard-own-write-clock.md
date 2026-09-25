---
"@n-dx/rex": patch
---

A PRD save no longer risks refusing to clean up its own previous write

The stale-save guard judges deletion candidates by mtime against the
`loadedAt` the store adopted after its last save. That `loadedAt` was a bare
`Date.now()` taken after the files were written — and on Windows the
filesystem clock can run ahead of `Date.now()` by more than the guard's
tolerance, so a store's next save intermittently read its *own* just-written
files as another writer's newer work and refused. The serializer now reports
the largest mtime it wrote (`SerializeResult.maxWrittenMtimeMs`) and both
local stores adopt `max(Date.now(), that)` instead.
