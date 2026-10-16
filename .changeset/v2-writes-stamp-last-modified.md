---
"@n-dx/rex": patch
---

Writes on a v2 tree now stamp `lastModified` and `lastModifiedBy` on every
node they change, create or move, as v1 writes do. Before, `update_task_status`,
`edit_item`, `add_item` and `move_item` left a node's old stamp in place and
gave a new change none, so remote sync and the dashboard read v2 writes as
stale. A write that changes nothing stamps nothing. The stamp lands in the
node's `state.yaml` row, so a write now also rewrites that file.
