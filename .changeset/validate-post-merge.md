---
"@n-dx/rex": patch
---

New `rex validate --post-merge`: structural check for a freshly merged PRD tree, with `--repair` for the safe classes.

A git merge of `.rex/prd_tree/` can leave corruption no rex code path produces, and none of it errored: duplicate IDs (both branches created or moved the same item at different paths), directories whose `index.md` was lost in conflict resolution, files at the wrong nesting depth, `blockedBy` references to items the other branch deleted, and unresolved conflict markers. The scan reads the raw tree — deliberately not the store, whose parser would normalize or choke on exactly this input — and reports every class.

`--repair` fixes the deterministic classes (empty orphaned directories removed, `level` rewritten to the depth-implied value, dangling `blockedBy` ids dropped while valid ones are kept) and refuses the ambiguous ones (duplicate IDs, conflict markers, orphaned directories that still contain items) with instructions. Exit codes are hook-friendly — 0 clean, including a repo with no PRD tree; 1 issues remain — and the folder-tree schema doc shows the optional git post-merge hook wiring.
