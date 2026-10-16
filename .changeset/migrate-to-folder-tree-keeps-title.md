---
"@n-dx/rex": patch
---

`rex migrate-to-folder-tree` keeps the PRD title

The command wrote the tree but not `.rex/tree-meta.json`, so a migrated project
read back as "PRD". It now writes the sidecar with the source document's title.
