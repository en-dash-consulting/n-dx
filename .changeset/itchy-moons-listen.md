---
"@n-dx/rex": patch
---

Fix silent data loss in `syncFolderTree`, the re-serialization step every PRD mutation handler runs after its transaction commits. It did an unlocked `loadDocument() → serializeFolderTree()` and passed no `loadedAt`, which disables the serializer's stale-save guard — so a document loaded before a concurrent writer's insert would delete that item from disk with no error and no log, even though the writer's `addItem` had resolved successfully. It now holds the folder-tree lock across the read and the write, and passes `loadedAt` so a bypassing writer fails loudly instead of losing work. The lock file name is shared as `PRD_TREE_LOCK_FILENAME` so writers cannot drift onto different lock files.
