---
"@n-dx/rex": patch
---

Correct the v2 PRD schema before any v2 files are written: the map layer is now the product layer (`ProductNodeType`, `PRODUCT_NODE_TYPES`, `V2Tree.product`), level-of-effort fields (`loeRationale`, `loeConfidence`) are declared and `effort` is reserved, change intent records `discoveredFrom` (the item or run that found it), and change and task intent carry an optional saved run-settings block (`run`) checked by a new run-settings warning rule. v2 is still not wired to the store.
