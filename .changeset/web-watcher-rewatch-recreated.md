---
"@n-dx/web": patch
---

Follow a PRD folder that is deleted and recreated while `ndx start` runs

`prd_tree/`, `product/` and `changes/` were watched once and never again, so after a branch switch removed and restored one, inotify and Windows kept a dead watch and edits inside it left `.rex/.cache/prd.json` stale until restart. The rex watcher now re-watches a folder whose inode changed, closing the old watcher and dropping it from the list.
