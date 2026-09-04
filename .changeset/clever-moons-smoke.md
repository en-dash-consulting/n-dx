---
"@n-dx/hench": patch
---

Stop the pre-run git gate self-blocking on hench's own lock directory

`ndx work --auto` on a project without hench's `.gitignore` entries refused to
start with "Refusing to start an autonomous run with 1 uncommitted file(s), 0
line(s) changed in the working tree" — and left a clean tree behind, so the
message looked unreproducible. The dirt was `.hench/locks/`, created at process
startup before the gate runs and removed again on exit.

The gate now discounts hench's own runtime artifacts (`.hench/locks/`,
`.hench/runs/`, `.hench/usage-cursors/`, `.hench-commit-msg.txt`) when reading
`git status --porcelain`, so a lock the run itself created can never count as
operator dirt. `.hench/config.json` is deliberately not discounted — it is
operator-authored and a pending change to it should still stop the run.

`hench init` also now writes those `.gitignore` entries ahead of its
already-initialized early return, so a project initialized before the entries
existed picks them up on the next `ndx init` instead of staying exposed.
