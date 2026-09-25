---
"@n-dx/hench": patch
---

The failed-run rollback prompt now offers only hench's own PRD writes, reverts only those, and defaults to reverting them. It used to offer the whole dirty working tree as one choice (`Revert N uncommitted file(s)? [y/N]`), so the agent's source edits and hench's status writes stood or fell together, and a bare Enter left the status writes in place — which was the actual damage. The prompt now lists the dirty PRD paths as hench's status writes from this run, reports everything else as the operator's own work it will leave alone, and defaults to Yes: a bare Enter reverts those paths and restores the pre-run PRD state, and an explicit `n`/`no` keeps them. The revert is scoped to the PRD paths in both directions: tracked changes outside them are untouched, and only agent-created untracked files inside them are removed. Rejecting a run under `--review` still reverts the whole working tree, which is the one case where discarding the agent's diff is the point.
