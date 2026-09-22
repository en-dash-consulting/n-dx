---
"@n-dx/rex": patch
---

`FolderTreeStore.adoptSlugRule` read the marker and decided whether the tree was adoptable *before* acquiring the PRD lock, then wrote with the direction check suppressed entirely. A concurrent writer that recorded a newer marker in that window — after the read, before the lock — had it silently overwritten by the migration, exactly the whole-tree downgrade the check exists to prevent. The read now happens inside `writeTree`, under the lock, immediately before `mkdir`, so the decision is made against the marker the write is actually about to land next to.
