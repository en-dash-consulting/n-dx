<!--
Keep the trailer block at the bottom. GitHub copies a PR's description into the
squash-merge commit message, so a trailer written here lands in history on main
— which is where rex looks for it. See `packages/core/commit-trailers.js`.
-->

## What

<!-- What changed, and why. One or two sentences. -->

## How to verify

<!--
The scoped commands a reviewer can run: `pnpm --filter @n-dx/<pkg> exec vitest
run <file>`, `node scripts/run-all-tests.mjs <suites>`, or the CLI invocation
that shows the behaviour. See TESTING.md.
-->

## Checklist

- [ ] Changeset added (`pnpm changeset`, scoped name, `patch` unless told otherwise)
- [ ] Scoped tests pass for every package touched
- [ ] `N-DX-Item` below names the PRD item, or the line is removed because there is none

---

<!--
THE TRAILER BLOCK. One `Key: value` line per line, no blank lines inside it,
nothing after it — git stops parsing trailers at the first blank line, so a
line below this block is body text and will not be read.

`N-DX-Item` is what ties this change to the PRD item it realizes. rex's
`computeChangeCommits` asks git for `%(trailers:key=N-DX-Item)` and reads no
other part of the message, so a PR without it is invisible to the evidence
layer even when the subject names the item.

Emit it when this PR is for exactly ONE item. Use the bare id — never a
dashboard URL, which would bake your host into permanent history. Delete the
line entirely when the PR spans several items or none (a dependency bump, a
docs fix); naming one of several would attribute the whole change to it.
-->

N-DX-Item: <item-id>
