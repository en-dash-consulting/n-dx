---
"@n-dx/rex": patch
---

`rex reshape` on the product layer no longer drafts a merge that would lose data: a merged node with tags, notes outside History, requirements, dependsOn or appliesTo, or one another live node names, is skipped with the reason.
