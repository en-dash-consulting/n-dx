---
"@n-dx/hench": patch
---

The failed-run rollback prompt now offers only hench's own PRD writes, and reverts only those. It had been handed the entire dirty working tree under the sentence "hench's status writes from this run" — so it named the agent's finished source edits as bookkeeping, and since the prompt defaults to Yes, a bare Enter ran `git checkout .` over all of them. The prompt now lists the dirty PRD paths, reports the rest as the operator's own work it will leave alone, and the revert is scoped to the PRD paths in both directions: tracked changes outside them are untouched, and only agent-created untracked files inside them are removed. Rejecting a run under `--review` still reverts the whole working tree, which is the one case where discarding the agent's diff is the point.
