---
"@n-dx/rex": minor
---

Add a cross-worktree task claims store, `openClaimsStore(projectDir)`, kept at `<git common dir>/ndx/claims.json` so every worktree of a repository sees the same claims (and git never tracks it). A claim carries the task id, the worktree root, the holder's pid, host and expiry (default 4 h); it is live while the pid exists and has not expired, and dead or expired claims are ignored by readers and pruned by the next writer. Writes hold an advisory `claims.lock` and land by atomic rename, so two processes claiming at once see one winner. Outside a git repository the store is a no-op and behaviour is unchanged.
