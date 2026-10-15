---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

On a v2 tree, `edit_item`, `move_item` (the item and the new parent), `merge_items`
and `claim_task`, and `rex update`, take a change's display id (`CH-1`) or alias
as `get_item` does, instead of refusing it as "not found". `hench run --resolve`
reports a subtask or a container change with the run's own message ("is a
subtask … Run the task instead", "holds other changes") rather than
`task-not-found`.
