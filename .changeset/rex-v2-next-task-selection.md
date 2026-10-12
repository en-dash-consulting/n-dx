---
"@n-dx/rex": patch
---

On a v2 tree, `get_next_task` and `rex next` select through the change-layer rules (`findNextWork`): placed changes and their tasks, a change with no tasks as its own unit, never an Inbox change awaiting placement, and nothing another worktree has claimed. A change that holds another change is a container: selection descends into the nested change instead of picking the outer one, and the enclosing change's gates (placement, status, blockers) apply to everything inside it. v1 selection is unchanged.

MCP fields added on a v2 tree (optional, absent on v1; MCP tool shapes are soft-frozen since 0.9.0):

- `get_next_task`: `item.type`, `item.displayId` and the item's other v2 fields (`slug`, `touches`, …), as stored.
- `get_next_task`: `parentChain[].type`.
- `get_next_task`: `changeId`, the change the selected unit belongs to.
- `rex next --format=json`: `changeId`.
