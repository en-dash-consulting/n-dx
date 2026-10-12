---
"@n-dx/hench": patch
---

On a v2 tree, `ndx work` selects with rex's v2 selection (the unit `get_next_task` returns) instead of the v1 selector over the projected change layer, so Inbox changes and gated changes are no longer picked. `--task` accepts an id or a display id, `--loop` moves through v2 units until none are left, and `--epic-by-epic` and `--epic` are refused because a v2 tree has no epic level. v1 is unchanged.
