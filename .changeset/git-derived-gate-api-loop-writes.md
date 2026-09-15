---
"@n-dx/hench": patch
---

Recognize API-loop writes in the git-derived completion gate.

Three ways a run's real work went unseen — or hench's own bookkeeping was
counted as work — by `discoverChangedFiles`, which decides both whether the
full-suite gate runs and whether a completion claim is allowed to stand:

- **A repository with no commits rejected every completion.** `git diff HEAD`
  fails on an unborn HEAD exactly as it does outside a repository, and both
  were read as "git could not answer". In a freshly `git init`-ed project the
  agent wrote real files, the gate saw no evidence, and the run failed with
  "No changes detected" — permanently, since no agent action can produce a
  commit for the gate to diff from. An unborn HEAD is now treated as the known
  baseline it is: the working tree is read from `git status` instead.
- **A project nested below the repository root counted its own bookkeeping as
  work.** git reports diff and porcelain paths relative to the *repository*
  root, so `.rex/` writes arrive as `sub/.rex/…` and the bare prefix test
  matched none of them. Every run then "changed files" on hench's own
  task-status write alone. The shared `matchesProjectPath` matcher now applies,
  with the same repo-relative prefix the uncommitted-work gate uses, so the two
  gates cannot disagree about the same path.
- **`.hench-commit-msg.txt` counted as work.** hench writes its commit-message
  handoff at the repository root, under neither `.rex/` nor `.hench/`, so a run
  whose only output was that scratch file satisfied the completion gate on it.
  The shared runtime-artifact list is now consulted.

The gate is not weakened: a completion claim with no agent work still fails,
and `.rex`/`.hench` bookkeeping alone is still not meaningful work.
