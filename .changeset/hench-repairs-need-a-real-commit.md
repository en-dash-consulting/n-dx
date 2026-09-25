---
"@n-dx/hench": patch
---

Count review repairs as uncommitted work unless a commit will really follow.

The completion gate excluded `review.repairedFiles` on the promise that a later
step of the run commits them — `commitReviewRepairsIfNeeded` on `autoCommit`, or
the commit prompt's `stageReviewRepairs` otherwise. But that prompt returns early
when `.hench-commit-msg.txt` is missing or empty, so with `autoCommit: false` and
no message file nothing committed the repairs. The staged-index exclusion beside
it was already conditioned on a non-empty message file; this one was not.

It mattered more than the index does. A "repair" is every path the review pass
changed, so it covers files the agent created and the reviewer then edited — in
one consumer run that was the entire feature, a new module and its test. The
refusal named only `package.json` and `package-lock.json`, and its "commit exactly
these paths" commands would have left both new files behind. With nothing else
dirty the same discount made the tree look clean, and the task reached `completed`
with its whole diff still untracked.

Repairs are now excluded only when `autoCommit` is on or a non-empty commit message
file exists — the same condition as the staged index. When neither holds, they are
named in the refusal and in its recovery commands along with everything else.
