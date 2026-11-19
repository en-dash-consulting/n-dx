---
"@n-dx/rex": patch
---

`rex update <id> --prioritized` marks a change as prioritized so the dashboard lists it first; `--prioritized=false` clears it, and `rex add --prioritized` sets it on a new change.

The flag is stored as `prioritized: true` in the change's `index.md` frontmatter on a v2 PRD (an unknown field on a v1 epic) and removed, never written as `false`, when cleared. The MCP `add_item` and `edit_item` tools take a `prioritized` boolean the same way. Only a change (a v1 epic) carries it: a task or subtask is refused. Task selection (`get_next_task`, `ndx work`) does not read it.
