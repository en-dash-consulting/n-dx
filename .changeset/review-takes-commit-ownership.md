---
"@n-dx/hench": patch
---

`--review` now takes commit ownership from the executor, so must-fix repairs
land in the commit they repair.

With `hench.autoCommit: true` the agent was instructed to commit inside its own
turn, while the adversarial review pass runs after the spawn returns. The
promise that repairs ship alongside the work they fix was therefore unreachable
by construction — on the first real review-enabled run the work committed
8m40s before the reviewer even started.

Review-enabled runs now force `autoCommit` off: the agent stages its changes and
writes a proposed commit message, and hench commits after the review pass. That
also folds the PRD status transition into the same commit instead of the
autoCommit path's separate follow-up commit. Runs where the override applies
print a line saying so, and the review pass warns if HEAD moved anyway.
