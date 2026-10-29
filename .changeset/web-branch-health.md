---
"@n-dx/web": patch
---

New `GET /api/branch-health` reports the addressed worktree's branch by fixed rules, with no model call: its base and where the base came from (the PR's base, else the upstream, else origin's default branch), commits ahead and behind, files `git merge-tree --write-tree` predicts will conflict with their stages, and whether each branch it stacks on is contained. The worktree, index and HEAD are never touched. When `web.sidecarGithubReads` is true and the request asks with `?github=1`, it also reads the PR with `gh pr view`, and gives each failing check the tail of its failed log and a class: behind-base, policy-test, codeql, touched-test, fork-no-ci or unclassified. Checks are classed on the whole log, and behind-base also follows the PR's `BEHIND` merge state and any stack layer not contained. A local-only answer reuses the PR base an earlier GitHub read found, and says when it has not been read yet. With GitHub reads off, or gh missing, no gh command runs and the local facts still answer.

Each predicted conflict is classified by fixed rules and carries a fix that a person runs; nothing is run or written for them:

- `prd-children-table` (a v1 PRD `index.md` whose conflicts are all `## Children` rows): `git checkout --ours`, `rex validate --post-merge --repair`, `git add`, `rex validate`.
- `prd-state` (a v2 `state.yaml` while the rex-state merge driver is unregistered): register the driver and redo that file's merge.
- `duplicate-capture` (both sides added the same PRD item under different ids): keep the base's id.
- `allowlist-union` (both sides only added list entries: YAML `- ` items, quoted strings, one-line array rows or JSON array elements; never a lockfile, and an added code block or mapping is `source`): a unified diff holding both additions, this branch's first.
- `generated` (a path in the new `web.generatedFiles` setting, `[{ paths, command }]`): take the base's copy, run the declared command, `git add`, after every other fix.
- `source` (everything else): no fix; names the other local worktrees whose branch changed the same file (the card shows three and counts the rest).

A new experimental toggle, `git.branchHealth` (off by default), adds a health strip to each Workspaces card that expands to the full status, listing each conflicted file with its class and fix: steps as copyable commands, diffs collapsed. The board reads local facts on open and asks GitHub only when a card is expanded. While the toggle is off the endpoint refuses with 403 and the cards are unchanged.
