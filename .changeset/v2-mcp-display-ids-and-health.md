---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

v2 MCP tools take display ids and report v2 health.

- On a v2 tree, the MCP tools `update_task_status`, `edit_item`, `move_item` (the item and the new parent), `merge_items`, `claim_task` and `release_task`, and the `rex update` command, accept a change's display id (`CH-1`) or alias as `get_item` does, instead of refusing it as "not found". The tools' inputs are wider; no output changes.
- On a v2 tree, the MCP `health` tool adds a `v2` field to its response: the tree rules, reader warnings and landing check that `rex health` shows. Every existing field is unchanged, and v1 responses are identical. A v2 project with no `.rex/config.json` gets its score and the v2 report on default thresholds.
- `rex health` and MCP `health` on a v2 tree no longer fail when `package.json` is not valid JSON; the title release-token rule skips and the rest of the report is returned.
- hench: `ndx work --resolve` reports a subtask or a container change with the run's own message ("is a subtask … Run the task instead", "holds other changes") rather than `task-not-found`.
