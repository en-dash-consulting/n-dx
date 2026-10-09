---
"@n-dx/rex": patch
---

`rex health` on a v2 tree now prints the reader's warnings under "Reader warnings:" and adds a `warnings` array beside `treeRules` in `--format=json`, so skipped nodes and folders without `index.md` no longer read as "no findings".
