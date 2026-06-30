---
"@n-dx/sourcevision": patch
---

Fix stale zone-partition cache surviving a sourcevision upgrade. `analyzeZones` reuses a cached partition when the input fingerprint is unchanged, but the fingerprint omitted the partitioning-algorithm version — so after an upgrade that changes how files are grouped, projects with unchanged files kept serving the old algorithm's zones (surfacing as, e.g., an empty codebase map). A new `ZONE_ALGORITHM_VERSION` is folded into the fingerprint and bumped, so the next `analyze` recomputes instead of reusing a stale partition — no manual `.sourcevision` deletion or zone pins required.
