---
"@n-dx/rex": patch
---

`rex reshape`, `rex reorganize` and `rex prune` are layer-aware on a v2 PRD. The change layer is restructured as on a v1 PRD; nothing under `product/` is written. On the product layer, reshape drafts accepted proposals as one change with removed and added amendments (a move or split that would drop a node's tags, body, requirements or dependsOn, or orphan a reference to it, is reported and not drafted), reorganize only reports, and prune does not apply. v1 trees behave as before.
