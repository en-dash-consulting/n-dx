---
"@n-dx/hench": patch
---

`--reset-deferred` now commits only its own PRD write, and writes nothing on `--dry-run`.

The reset's auto-commit stages `.rex/prd_tree/` wholesale, so an operator edit already sitting there was committed too — under `chore(prd): reset N deferred/failing task(s)`, with hench's Co-Authored-By trailer, in a TTY, with no prompt. The PRD tree is now checked for existing dirt *before* the reset writes; when it is already dirty the reset still runs but nothing is committed, and the pre-run gate reports the tree and exits 1 as it did before. Dirt outside the PRD tree still commits normally.

`--dry-run --reset-deferred` no longer writes the reset to disk. It previously left `.rex/prd_tree/` dirty (the commit is skipped on a dry run), which made the next real autonomous run refuse to start.

Hench's PRD commits are now scoped to a pathspec. `git commit` with no pathspec commits the whole index, so work the operator had staged before the run was committed under `chore(prd): …` with hench's trailer — by the reset above, and equally by the completion-metadata commit on the `--auto-commit` path. Both now land only `.rex/prd_tree/` and `.rex/tree-meta.json`, leaving anything else staged and untouched.
