---
"@n-dx/rex": patch
---

`rex update <id> --prioritized` marks a v2 change as prioritized so the dashboard's Inbox and Open changes list it first; `--prioritized=false` clears it, and `rex add --prioritized` sets it on a new change.

On a v2 PRD the flag is stored as `prioritized: true` in the change's `index.md` frontmatter and removed, never written as `false`, when cleared. On a v1 PRD an epic takes it as an unknown field, but it is only stored there: no v1 list orders by it. The MCP `add_item` and `edit_item` tools take a `prioritized` boolean the same way. Only a change (a v1 epic) carries it: a task or subtask is refused. Task selection (`get_next_task`, `ndx work`) does not read it.
