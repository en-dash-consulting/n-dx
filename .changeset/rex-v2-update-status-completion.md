---
"@n-dx/rex": patch
---

On a v2 tree, `update_task_status` and `rex update --status=completed` complete work through the change-layer rules, sharing one implementation in one PRD transaction. When the last live task of a pending change completes, the change completes too, and under `rex.applyOn: complete` (the default) its amendments apply to the product layer in the same write. Under `review` or `release` the change stays completed but unapplied. An `in_progress` change is never completed by its tasks (#368). A change that needs placement is held open. A subtask completes its pending task when it is the last one. A change completes directly when its id is passed. A task-less change that gains its first task still splits as before. v1 trees keep today's cascade.

MCP fields added on a v2 tree (optional, absent on v1; MCP tool shapes are soft-frozen since 0.9.0):

- `update_task_status` (status `completed`): `changeId`, the change the item belongs to (itself when it is a change).
- `update_task_status` (status `completed`): `changeCompleted`, whether that change is now completed.
- `update_task_status` (status `completed`): `applied`, whether its amendments were applied in this write.
- `update_task_status` (status `completed`): `reason`, why the change was held open or left unapplied.
- `update_task_status` (status `completed`): `warnings`, `rex.applyOn` config warnings.
- `rex update --format=json` (status `completed`): `changeId`, `changeCompleted`, `applied`, `reason`.
