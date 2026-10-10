---
"@n-dx/graview": patch
"@n-dx/core": patch
---

The Graview projection carries rex's `lastModified` and `lastModifiedBy` on every change and task: the version a two-way sync agrees on. `ndx graview info .` names where the projection lands, which graview binary runs, and the hub's per-project rex MCP endpoint a product face writes back through; `ndx graview serve .` hands that face `NDX_REX_MCP_URL`, `NDX_TOKEN_FILE`, `NDX_PROJECT_ROOT` and `NDX_GRAVIEW_CLI` beside `NDX_GRAVIEW_DIR`. The sync loop itself runs in the product face (`@n-dx/graview-face`), because Graview's `SyncEngine` is a Graview interface and no n-dx package depends on `@graview/*`; rex stays the single PRD writer, and every push is a rex MCP write under the file lock and the execution log.
