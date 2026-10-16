---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`assignee` can now be written, not only read. The field has been on the item schema and honoured by task selection for some time — `matchesAssignee` inherits it down the parent chain and `ndx work --mine` filters on it — but nothing exposed a way to set it, so hand-editing frontmatter was the only route.

`rex update <id> --assignee="<name>"` sets it and `--assignee=` removes it, matching how `--source` behaves. MCP `edit_item` and `add_item` both take an `assignee` parameter, and on `edit_item` an empty string removes it so an item can be unassigned without touching files by hand. The value is trimmed on the way in, because selection matches it exactly.

The v2 layout is covered too: `addChangeNode` carries `assignee` onto changes, tasks and subtasks, so a v2 PRD is not left with the same read-only field the v1 one had.

No storage change was needed — the folder-tree serializer already round-tripped the field as an unknown extra, and v2 already routed it into `state.yaml` from `ItemStateSchema`.
