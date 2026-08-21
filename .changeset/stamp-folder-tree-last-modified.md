---
"@n-dx/rex": patch
---

Stamp an ISO `lastModified` on every `FolderTreeStore` mutation (`addItem`, `updateItem`, and — on the affected parent — `removeItem`). Previously `FolderTreeStore` ignored this entirely, so `SyncEngine.isModifiedSinceSync()` always returned false for folder-tree-backed items and locally edited items were silently skipped on `push`. `lastModified` is an existing passthrough field (see `packages/rex/src/core/sync.ts`), so this is additive and does not change the PRD schema.
