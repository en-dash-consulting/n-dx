---
"@n-dx/web": patch
---

The Live idle card and the Workspaces cards now use the shared start offer: an in-progress next task with no live run shows Resume, a blocked one names its blockers, and one with a live run links to its Live page. `/api/live` next tasks now carry `status` and `blockedBy`.
