---
"@n-dx/rex": patch
"@n-dx/web": patch
---

On a v2 project the dashboard can add a task under a change. A change's detail panel offers "+ Add Task", with a title, description, criteria and priority, and the task is written under the change through rex's own add rule, as `rex add --type=task --parent=<id>` and MCP `add_item` write it. A completed change refuses a new task with rex's reason. `POST /api/rex/items` with a parent used to be refused on v2, which left a project started from the dashboard with changes that had no tasks.
