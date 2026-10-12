---
"@n-dx/rex": patch
---

`rex migrate --apply [--plan=<path>]` applies a reviewed v1 → v2 migration plan. It writes `product/` and `changes/` and removes `prd_tree/` and `tree-meta.json` under one hold of the PRD lock, so the two layouts never sit side by side. Held changes, and items made after the plan, land in the Inbox. Every v1 id is checked by count and id before anything is written. The first change, "Product map and change layer", records the cut. Apply refuses a plan whose model pass stopped. On a v2 tree it reports so and exits zero.
