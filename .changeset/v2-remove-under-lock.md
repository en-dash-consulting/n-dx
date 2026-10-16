---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`rex remove <id>` now works on a v2 PRD, removing a change, task or subtask inside the PRD lock. `ndx destroy-sample` on a v2 project uses it instead of deleting change folders itself, and fails naming the lock holder when another writer holds the lock.

Widens a CLI command under the soft freeze: `rex remove` accepts v2 change, task and subtask ids (it refused v2 trees before). No flag or MCP tool changes shape.
