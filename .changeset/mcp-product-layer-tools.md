---
"@n-dx/rex": patch
"@n-dx/core": patch
---

New rex MCP tools for a v2 PRD: `get_product` (areas, capabilities and constraints with computed status and health), `get_capability` (one node with its parent chain, related changes, binding constraints and co-changes), `place_change` (the rules' placement shortlist without `target`; with `target`, records a touches or a modified amendment and clears `needsPlacement`) and `apply_change` (a steward applies a change's amendments whatever `rex.applyOn` says). Each refuses a v1 tree. On a v2 tree `get_prd_status` reports change counts, the Inbox count, product status per area and change counts per release. The assistant-assets manifest lists the four tools.
