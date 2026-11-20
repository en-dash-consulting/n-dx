---
"@n-dx/web": patch
---

A Sidecar card touching an item an agent run is working on now warns and needs a second Approve (experimental, off by default; enable with `web.sidecar`).

The check covers runs in every worktree and claims a worktree holds for a run, and a held task's parents count as held too. The server checks again on approval: an item that became held while the card waited answers 409 until the approval acknowledges it. A card approved over the warning keeps a note saying so. The session's brief opens with the items active work holds, so the Sidecar avoids proposing writes to them.
