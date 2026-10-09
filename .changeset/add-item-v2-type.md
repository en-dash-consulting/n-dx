---
"@n-dx/rex": patch
---

MCP `add_item` takes `type` (change, task, subtask) plus `amends`, `touches` and `discoveredFrom` on a v2 tree, where `level` is refused. With no type it creates a change, and a change that neither amends nor touches lands in the Inbox with `needsPlacement`. A task under a completed, applied, cancelled or deleted change is refused (also in core `addTask`), and the error suggests a follow-up change with `discoveredFrom`. `get_item` reads v2 trees. On a v1 tree `add_item` works as before: `level` is now optional in the schema, `task`/`subtask` types stand in for it, and v2-only types and fields are refused naming the v1 layout.
