---
"@n-dx/rex": patch
---

The rex MCP tools serve a v2 PRD through the change-layer store: `edit_item`, `move_item`, `merge_items`, `claim_task`, `release_task`, `verify_criteria`, `facets`, `health`, `reorganize` and `get_token_usage` work on the change layer. On a v2 tree `move_item` follows node types (a task moves between changes; a change never goes under a task), `merge_items` merges sibling changes only (carrying their `touches`, and refusing to absorb a change that carries amendments), `edit_item` refuses `level`, and `claim_task` claims a task or a change with no tasks. v1 trees behave as before.

MCP fields added on a v2 tree (optional, absent on v1):

- `edit_item`: `item.type`, `item.displayId` and the item's other v2 fields (`slug`, `touches`, `amends`, …), as stored.
- `move_item`: `type`.
- `claim_task`: `type`.
