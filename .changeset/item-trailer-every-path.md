---
"@n-dx/core": patch
"@n-dx/hench": patch
---

Carry `N-DX-Item` on every commit that is for one PRD item

The trailer is how rex's realized-by edge finds the commits that realize an
item — `computeChangeCommits` reads it and no other part of the message. Only
hench's work commit emitted it, so a task whose code the operator committed by
hand, or one driven through `/ndx-work` rather than `ndx work`, left nothing in
history for the edge to find.

Three paths now emit it: hench's `chore(prd):` record commit names the completed
task, the `/ndx-work` skill gained a commit step whose trailer block names the
task it implemented, and `/ndx-capture` names the item it created. The rule is
stated once in `packages/core/commit-trailers.js`, whose `buildTrailerBlock` and
`buildCommitMessage` take an optional item id: **emit `N-DX-Item` when the commit
is for exactly one item.** A commit spanning several emits none, because naming
one of the N would attribute the whole commit to it — that leaves hench's
`--reset-deferred` commit, the pre-run gate commit, and the `ndx-plan` /
`ndx-reshape` / `ndx-adversarial-review` skills unchanged.

The repository also gains `.github/pull_request_template.md`, ending in a trailer
block: GitHub copies a PR description into the squash-merge commit, so that is
where the trailer has to be for it to reach `main`.
