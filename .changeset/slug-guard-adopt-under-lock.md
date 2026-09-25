---
"@n-dx/rex": patch
---

`rex migrate-slugs` decides whether a tree is adoptable against the marker it reads inside the PRD lock, immediately before the write, rather than against one read before the lock was taken. A concurrent writer that records a newer marker in that window therefore cannot have it silently overwritten by the migration — exactly the whole-tree downgrade the direction check exists to prevent.

This holds in both local stores. `FileStore` is the one that matters in practice: `resolveStore` returns it, and `rex migrate-slugs` resolves its store through `resolveStore`, so it is the path every real migration takes.
