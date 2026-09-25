---
"@n-dx/rex": patch
"@n-dx/hench": patch
"@n-dx/core": patch
---

A refused completion no longer hands the task back to other worktrees, and claims can now be inspected and freed from the CLI.

When the uncommitted-work gate refuses to mark a task complete, the run's cross-worktree claim is held instead of released: the work is real and it is in that worktree, so freeing the task invited a second worktree to redo it. A held claim records why it is held, survives its holder's exit (an ordinary claim dies with its pid), and does not expire — it ends only when someone deals with the work: `ndx claim release <id>`, `release --all` from the worktree that left the work, `release --force`, or a fresh claim from that worktree (a re-run there clears the hold). Another worktree passes the task over; `hench run` and the dashboard's Execute, asked for it explicitly, say the task is held, that the hold does not expire, and how to clear it, rather than "is being worked on". Ordinary claims keep their existing lease-and-pid liveness exactly as before.

New `ndx claim` (`rex claim`): `list` shows every live claim with task title, worktree, holder liveness, state and expiry (a held claim reads `expires: never — held until released`); `release <taskId>` frees one — from whichever worktree the operator is standing in when the claim is held or its holder is dead — refusing while the holder is alive unless `--force`; `release --all` frees this worktree's held and dead-holder claims, keeping any a live run is still working unless `--force`. `--format=json` throughout.
