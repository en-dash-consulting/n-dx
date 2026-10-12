---
"@n-dx/rex": patch
---

`rex migrate-to-folder-tree`, `migrate-to-md` and `migrate-folder-tree-filenames` refuse on a v2 tree, writing nothing, instead of creating a v1 `prd_tree/` or `prd.md` beside `product/`. v1 is unchanged. No MCP field is added.
