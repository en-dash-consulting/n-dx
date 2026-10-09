---
"@n-dx/rex": patch
---

Give migrations their own home in `src/migrations/`, so a schema migration can be deleted as a unit. A migration plans from a source adapter rather than a tree type, through a pipeline of rules, then an optional text pass, then an optional Jev pass, each calling an injected seam. It writes a JSON plan file: a header (migration id, source digest, `cutAt`, passes and their models), entries keyed by source item id, and recorded model answers keyed by item id and content hash, so re-planning reuses the answer for an unchanged item. The v1-to-v2 plan modules moved into `migrations/v1-to-v2/` and are registered as the `v1-to-v2` migration. Not wired to a command yet.
