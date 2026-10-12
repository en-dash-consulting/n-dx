---
"@n-dx/rex": patch
---

On a v2 tree, a change that holds a nested change is a container, never a unit of work, everywhere: `claim_task` refuses it and names the nested changes and tasks to claim instead, and `resolveWorkById` returns `null` for it. `changeWorkShape`, the shared judgement, is exported from the public entry. No MCP fields added.
