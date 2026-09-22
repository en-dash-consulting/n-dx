---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/core": patch
---

A refused completion no longer hands the task back to other worktrees, and claims can now be inspected and freed from the CLI.

When the uncommitted-work gate refuses to mark a task complete, the run's cross-worktree claim is held instead of released: the work is real and it is in that worktree, so freeing the task invited a second worktree to redo it. A held claim records why it is held, survives its holder's exit (an ordinary claim dies with its pid), and lapses at its original expiry. Another worktree passes the task over and, if it asks for it explicitly, is told what happened and how to clear it rather than "is being worked on".

New `ndx claim` (`rex claim`): `list` shows every live claim with task title, worktree, holder liveness, state and expiry; `release <taskId>` frees one, refusing while the holder is alive unless `--force`; `release --all` frees this worktree's claims. `--format=json` throughout.
