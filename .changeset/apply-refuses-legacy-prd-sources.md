---
"@n-dx/rex": patch
---

`rex migrate --apply` (and its dry run) now refuses while `.rex/prd.md`, `.rex/prd.json` or a branch-scoped `prd_<branch>_<date>.json` sits beside the tree, naming the files, instead of letting the next v1 command migrate them back into a `prd_tree/` beside the v2 tree.
