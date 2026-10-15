---
"@n-dx/rex": patch
---

A v2 change can no longer get stuck after being applied while in progress. `rex change apply` and MCP `apply_change` now refuse a change whose live tasks or nested changes are not all completed, naming them, and write nothing. Completing a change that was already applied (`rex update --status=completed`, `update_task_status`) closes it with `completedAt` and does not apply its amendments again. Previously such a change could never be completed.
