---
"@n-dx/web": patch
---

Test-only: the worktree run-watcher test no longer races macOS FSEvents startup. It rewrites the run file on each retry, spaced above the watcher's debounce, so a write made before the watcher is live is not missed.
