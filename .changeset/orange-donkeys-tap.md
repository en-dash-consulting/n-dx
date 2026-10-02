---
"@n-dx/hench": patch
---

Commit review repairs when the executor committed for itself and left no commit message (#483).

With `hench.autoCommit` false, review repairs were committed only by the commit prompt, which returns early when `.hench-commit-msg.txt` is missing or empty. An executor that committed its own work with a plain `git commit` left the repairs with no owner, and the uncommitted-work gate correctly refused them — so a run whose work and repairs were both correct ended failed and its task was reset to pending.

The completion gate now commits those repairs itself, but only when the executor really did commit (HEAD has moved past the run's starting commit) and the repairs are the only thing left in the tree. Without the first condition the "repairs" may be the whole uncommitted feature, which must not land under a `fix(review):` subject; without the second, the existing refusal is still the right answer.

When that commit is refused — a moved checkout, for example — the refusal names the cause instead of the generic uncommitted-work message, and gives the two-command recovery: commit the repaired paths, then `ndx rex update <id> --status=completed`. It does not offer `git stash` and does not tell the operator to re-run a task whose work is already in history.
