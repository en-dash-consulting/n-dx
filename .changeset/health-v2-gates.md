---
"@n-dx/rex": patch
"@n-dx/core": patch
---

On a v2 tree, `rex health` exits 1 when a tree rule reports an error or the reader skipped a node; warnings alone exit 0. `ndx ci`'s structure-health step gates on that exit code and shows error, warning and skipped-node counts instead of "score: undefined". v1 is unchanged.
