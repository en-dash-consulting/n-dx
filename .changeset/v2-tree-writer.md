---
"@n-dx/rex": patch
---

Add the v2 tree writer (`store/prd-model-writer.ts`). Paths come from each node's frozen `slug`, so a title edit never moves a file. No `index.md` gets a Children table. Intent goes to Markdown and state goes to `state.yaml`. The schema stamp and slug rule go in `product/index.md`, not `tree-meta.json`. A change is always a folder. The writer refuses to delete a file holding a node the model lacks unless the caller names it as removed. The v2 fixture round-trips byte-identically. v2 is still not wired to the store.
