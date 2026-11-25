---
"@n-dx/sourcevision": patch
---

Every analysis file `sv analyze` writes (`imports.json`, `zones.json`, `outbound.json`, `readiness.json`, `config.json`, `legacy.json` and the rest) now carries a top-level `schemaVersion`.

It is the same version `manifest.json` carries. `sv validate` still accepts files written before the field existed. Output stays canonical: two analyses of an unchanged repository write byte-identical files.
