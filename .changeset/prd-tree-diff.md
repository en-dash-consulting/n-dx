---
"@n-dx/rex": patch
"@n-dx/web": patch
"@n-dx/core": patch
---

Add `rex tree-diff` (`ndx tree-diff`) to compare two PRD trees.

The diff is by item id over the flattened trees, into `added`, `changed`,
`completed`, `moved` and `removed`, each entry carrying the item's ancestor
chain so a bare id does not have to be looked up to be understood. Because
it keys on the id, a reparented item is reported once as `moved` — with both
its old and new chains — rather than twice as an unrelated removal and
addition.

With no flags it compares this checkout's working tree against the default
branch, which answers "what has this branch done to the PRD". `--from=<ref>
--to=<ref>` compares two commits, `--against=<dir>` compares two checkouts on
disk (a worktree against its anchor), and `--json` prints the machine-readable
form. Identical trees produce an empty diff. A ref from before the PRD tree
existed reports `present: false` rather than reading as a tree-sized list of
additions.

The command is read-only: it takes no PRD lock and writes nothing, so it can
be run while another command is writing the tree. Reading the tree at a ref
materialises it into a temp directory through a single
`git checkout` with `GIT_INDEX_FILE` pointed at a throwaway index, so the
caller's index and working tree are untouched.

The dashboard's Workspaces PRD delta now computes through the same
`diffTrees` engine rather than its own copy of the id-indexing and
field-comparison loop — its published payload is unchanged, but the CLI and
the dashboard can no longer disagree about the same pair of trees.
