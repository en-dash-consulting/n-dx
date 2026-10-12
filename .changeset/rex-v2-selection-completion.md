---
"@n-dx/rex": patch
---

Selection and completion run through the v2 rules.

- On a v2 tree, `get_next_task` and `rex next` select through the change-layer rules (`findNextWork`): placed changes and their tasks, a change with no tasks as its own unit, never an Inbox change awaiting placement, and nothing another worktree has claimed. A change that holds another change is a container, never a unit of work: selection descends into the nested change, `resolveWorkById` returns `null` for the container, and `claim_task` refuses it, naming the nested work to claim instead. The enclosing change's gates (placement, status, blockers) apply to everything inside it. v1 selection is unchanged.
- On a v2 tree, `update_task_status` and `rex update --status=completed` complete work through the change-layer rules, sharing one implementation in one PRD transaction. When the last live task of a pending change completes, the change completes too, and under `rex.applyOn: complete` (the default) its amendments apply to the product layer in the same write. Under `review` or `release` the change stays completed but unapplied. An `in_progress` change is never completed by its tasks (#368). A change that needs placement is held open. A subtask completes its pending task when it is the last one. A change completes directly when its id is passed. A change holding an open nested change refuses to complete and writes nothing; completing the last open nested change completes each pending enclosing change in the same write and applies them innermost first. A task-less change that gains its first task still splits as before. v1 trees keep today's cascade.
- `get_prd_status` on a v2 tree counts capabilities and open changes under a nested area toward the top-level area's row.
- `@n-dx/rex`'s public entry exports the v2 runtime for hench and the dashboard: `prdLayout`, `loadPrdModel`, `withPrdModelTransaction`, `findNextWork`, `findActionableWork`, `resolveWorkById`, `findNextWorkTask`, `completedWorkIds`, `changeWorkShape`, `completeTask`, `completeChange`, `completeWork`, `completeV2Work`, `loadApplyOn`, `buildChangeBrief`, `renderChangeBrief`, `ChangeLayerStore` and their types. `ChangeCompletionResult` gains `applies`.

MCP fields added on a v2 tree (optional, absent on v1; MCP tool shapes are soft-frozen since 0.9.0):

- `get_next_task`: `item.type`, `item.displayId` and the item's other v2 fields (`slug`, `touches`, …), as stored.
- `get_next_task`: `parentChain[].type`.
- `get_next_task`: `changeId`, the change the selected unit belongs to.
- `update_task_status` (status `completed`): `changeId`, the change the item belongs to (itself when it is a change).
- `update_task_status` (status `completed`): `changeCompleted`, whether that change is now completed.
- `update_task_status` (status `completed`): `applied`, whether its amendments were applied in this write.
- `update_task_status` (status `completed`): `reason`, why the change was held open or left unapplied.
- `update_task_status` (status `completed`): `warnings`, `rex.applyOn` config warnings.

CLI JSON fields added on a v2 tree: `rex next --format=json` gains `changeId`; `rex update --format=json` (status `completed`) gains `changeId`, `changeCompleted`, `applied` and `reason`.
