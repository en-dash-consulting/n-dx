---
"@n-dx/hench": patch
---

On a v2 tree, `ndx work --task=<id> --resolve` now reports a task inside a
change another worktree claims as refused (`claimed-elsewhere`, naming the
change and its holder), as the run itself does. Selection and `--resolve`
share one `TaskClaims.heldByEnclosingChange` check.
