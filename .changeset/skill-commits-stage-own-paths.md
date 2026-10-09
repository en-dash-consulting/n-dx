---
"@n-dx/core": patch
---

The commit step in `/ndx-work`, `/ndx-capture`, `/ndx-plan`, `/ndx-reshape`, `/ndx-config` and `/ndx-adversarial-review` now stages only its own changes and works in linked worktrees. Each skill notes which paths are already dirty when it starts and stages, by explicit path, only the paths that were not, so the user's in-progress work is no longer swept into the commit by `git add -A`. The commit message is written to `.ndx-commit-msg.txt` at the project root instead of `.git/NDX_COMMIT_MSG`, which failed with "not a directory" in a linked worktree, where `.git` is a file.
