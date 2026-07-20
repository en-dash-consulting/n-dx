---
"@n-dx/web": patch
---

Add unit tests for `buildFileConnectionMap` — the per-file cross-zone connection map behind the Zones graph file rows. Covers bidirectional call-edge connections with weight accumulation, exclusion of same-zone/unresolved/unzoned edges, external-import mapping (`@n-dx/`-scoped and bare package names, src/-preferring zone resolution, same-zone skip), and combined call+import weights. `buildFileConnectionMap` is now exported from `viewer/views/zones.ts` for testability, matching its sibling helpers.
