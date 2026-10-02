---
"@n-dx/web": patch
---

The Live strip's "worktrees with a live run" and the Home pill's "running" count now go by each run's liveness verdict, so an abandoned record (`orphaned`) or another machine's run (`foreign`) is no longer counted as executing. It still shows under Needs attention.
