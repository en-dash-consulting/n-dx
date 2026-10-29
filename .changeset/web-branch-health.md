---
"@n-dx/web": patch
---

New `GET /api/branch-health` reports the addressed worktree's branch by fixed rules, with no model call: its base and where the base came from (the PR's base, else the upstream, else origin's default branch), commits ahead and behind, files `git merge-tree --write-tree` predicts will conflict with their stages, and whether each branch it stacks on is contained. The worktree, index and HEAD are never touched. When `web.sidecarGithubReads` is true and the request asks with `?github=1`, it also reads the PR with `gh pr view`, and gives each failing check the tail of its failed log and a class: behind-base, policy-test, codeql, touched-test, fork-no-ci or unclassified. Checks are classed on the whole log, and behind-base also follows the PR's `BEHIND` merge state and any stack layer not contained. With GitHub reads off, or gh missing, no gh command runs and the local facts still answer.

A new experimental toggle, `git.branchHealth` (off by default), adds a health strip to each Workspaces card that expands to the full status. The board reads local facts on open and asks GitHub only when a card is expanded. While the toggle is off the endpoint refuses with 403 and the cards are unchanged.
