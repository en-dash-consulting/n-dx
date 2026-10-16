---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`get_product` now answers with a summary by default: each area with its counts
of capabilities and constraints by status, defective nodes and open changes.
Pass `area` (an id or display id) for that area's capabilities and constraints,
or `full: true` for the whole map, the previous default. On a large v2 tree the
whole map exceeded what an MCP client accepts and was refused. The
`/ndx-capture`, `/ndx-plan`, `/ndx-reshape` and `/ndx-adversarial-review`
skills read the summary, then the areas they need.
