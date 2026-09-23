---
"@n-dx/hench": patch
"@n-dx/web": patch
---

A claim takeover in a linked worktree now reaches the Sessions tray when the run file is saved, not on the next poll.

`GET /api/worktrees` now watches every non-served worktree's `.hench/runs/` itself — previously only the Runs view registered those watchers, so with the tray open and the Runs view never visited, a takeover waited up to 15s. A runs-directory change also drops the worktrees answer cache, so the tray's refetch is not served a pre-change answer. On the hench side, a takeover observed before the run loop attached its listener is now stamped on the run too.
