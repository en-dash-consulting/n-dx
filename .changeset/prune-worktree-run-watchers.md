---
"@n-dx/web": patch
---

The dashboard closes a removed worktree's run watcher

The Sessions tray watches every other worktree's `.hench/runs/` so a claim
takeover or a finishing run reaches it as a push. Nothing closed those
watchers when a worktree was removed, so a long-running dashboard accumulated
handles on directories that no longer existed (the OS error event covers some
platforms, not all). The `/api/worktrees` refresh now prunes watchers whose
worktree left `git worktree list`; a worktree that comes back re-registers
lazily as before, and server shutdown still closes everything.
