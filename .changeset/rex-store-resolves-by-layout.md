---
"@n-dx/rex": patch
---

Store resolution is layout-aware. On a v2 PRD (`product/` present) `resolveStore` returns the change-layer store, so commands that open the PRD through it read and write the change layer instead of failing with "Rex directory not found". The v1 store refuses to read or write a v2 tree, with an error naming the v2 layout, and `rex init` no longer scaffolds `prd_tree/` beside `product/`. The "Run 'n-dx init'" hint appears only when the project has no PRD in either layout. `rex migrate-slugs` stays v1-only through the new `resolveV1Store`. No MCP tool fields are added. v1 trees behave as before.
