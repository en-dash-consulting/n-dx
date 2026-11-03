---
"@n-dx/web": patch
---

The proposal editor carries each task's status to accept-edited, so a completed (baseline) proposal accepted through Review & Edit on a v2 project creates no Inbox change, as Accept already did. On v2 both accept routes answer with `changeCount`, `taskCount` and `skippedCount`, so an accept where every proposal describes existing code says why nothing was added instead of returning a bare `addedCount: 0`.
