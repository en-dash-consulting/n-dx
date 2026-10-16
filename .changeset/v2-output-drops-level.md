---
"@n-dx/rex": patch
---

On a v2 tree the rex MCP `get_next_task` and `get_item` no longer return the v1
`level` on an item or its parent chain; `type` labels it, as it already did. `rex next`
prints `[change]`, `[task]` or `[subtask]` instead of `[epic]`, and its
`--format=json` drops `level` too. v1 trees keep `level` everywhere.
