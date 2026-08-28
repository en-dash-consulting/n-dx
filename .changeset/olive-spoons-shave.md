---
"@n-dx/hench": patch
---

Stop leaving the PRD completion metadata uncommitted when a run's commit step produces no commit. The cleanup commit was gated on `autoCommit`, which covered the agent-commits-its-own-work path and missed every other route to the same residue — most importantly `--review`, which forces `autoCommit` off so the reviewer has an uncommitted tree to repair, and whose agent may commit its own work anyway and leave nothing for the commit prompt to find. The gate is now the commit step's actual outcome; a commit the user declined, or one git rejected, is still left alone.

The leftover warning after a timer-expiry auto-commit now counts the whole working tree rather than only the index. Nothing on that path stages anything — the completion write runs without a `git add`, and the reviewer is told not to commit — so an index-only count printed "proceeding to next task" over a dirty tree.
