---
"@n-dx/core": patch
---

Remove `hench` from `PROJECT_SECTIONS` in `ndx config`. Adding it rerouted `ndx config hench.*` writes to `.n-dx.json` instead of `.hench/config.json` (breaking the package-config routing contract and its e2e tests) and made section reads drop `.hench/config.json` values. Reading `hench` overrides from `.n-dx.json` never needed the entry — hench merges that section itself via `loadProjectOverrides`.
