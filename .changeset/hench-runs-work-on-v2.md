---
"@n-dx/hench": patch
---

hench runs work on a v2 tree. v1 is unchanged.

- **Selection.** `ndx work` selects with rex's v2 selection (the unit `get_next_task` returns) instead of the v1 selector over the projected change layer, so Inbox changes and gated changes are no longer picked. `--task` accepts an id or a display id, and `--resolve` reports the unit by its real id and checks its claim on that id. `--loop` moves through v2 units until none are left. `--epic-by-epic` and `--epic` are refused because a v2 tree has no epic level.
- **Brief.** The agent brief is rex's change brief: the task, its change, and the capabilities and constraints the change touches or amends. Commit trailers and session filters still follow the task, and workflow.md is always carried, rendered outside rex's brief budget as on v1.
- **Completion.** hench completes a task through rex's v2 runtime (`completeV2Work`), as `update_task_status` does: completing a change's last task completes the change and applies its amendments per `rex.applyOn`. Before, the v1 ancestor cascade completed the change without applying it.
- **Bookkeeping.** The completion gate and save-report staging treat `product/` and `changes/` (`state.yaml` included) as PRD bookkeeping, as they do `prd_tree/` on v1. The review pass checks `changes/` for an existing item before filing a duplicate.
- **Agent tools.** The agent's rex allowlist adds `get_capability` and `place_change`; `apply_change` stays operator-only.
