---
"@n-dx/core": patch
---

The commit step in `/ndx-work`, `/ndx-capture`, `/ndx-plan`, `/ndx-reshape`, `/ndx-config` and `/ndx-adversarial-review` now stages only its own changes and works in linked worktrees. Each skill notes which paths are already dirty when it starts and stages and commits, by explicit path, only the paths that were not, so the user's in-progress work — staged or not — is no longer swept into the commit. Status is read with `core.quotepath=false`, so a file with a non-ASCII name is staged rather than aborting the step. Before its first write, each skill also checks whether it is about to change a path that was already dirty (for PRD writes, any dirty path under `.rex/prd_tree/`) and asks the user to commit or stash it first, so its commit holds the whole change. The commit message is written to `.ndx-commit-msg.txt` at the project root instead of `.git/NDX_COMMIT_MSG`, which failed with "not a directory" in a linked worktree, where `.git` is a file.
