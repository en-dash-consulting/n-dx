---
"@n-dx/web": patch
---

A placement or proposal written through a Sidecar card now logs `decidedBy` (`sidecar:<session id>`), `approvedBy` (the operator, as the change's `lastModifiedBy`) and the agent's reasons on its `change_placed` or `change_proposed` entry; a Plan-lens change-set placement logs the first two. CLI, MCP and dashboard placements log what they did before.
