---
"@n-dx/web": patch
"@n-dx/rex": patch
---

The Sidecar can change an item's status. A new `propose_status` card shows the current and proposed status and rex's own transition rule. Only Approve writes, through rex's `update_task_status` path and never forced, so completion still runs rex's checks, and a move rex refuses comes back as a failed card with rex's message. rex now exports `handleUpdateTaskStatus` and `validateTransition` for it.
