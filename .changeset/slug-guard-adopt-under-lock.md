---
"@n-dx/rex": patch
---

`adoptSlugRule` read the marker and decided whether the tree was adoptable *before* acquiring the PRD lock, then wrote with the direction check suppressed entirely. A concurrent writer that recorded a newer marker in that window — after the read, before the lock — had it silently overwritten by the migration, exactly the whole-tree downgrade the check exists to prevent. The read now happens inside the locked write, immediately before `mkdir`, so the decision is made against the marker the write is actually about to land next to.

Fixed in both local stores. `FileStore` is the one that matters in practice: `resolveStore` returns it, `FolderTreeStore` has no production construction site, and `rex migrate-slugs` resolves its store through `resolveStore` — so `FileStore` is the path every real migration takes, and the path this fix protects.
