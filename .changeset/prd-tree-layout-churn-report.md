---
"@n-dx/rex": patch
---

Make a PRD tree re-layout legible instead of alarming

Every PRD save rewrites the whole tree. So a change to the slug rule renames
every path at once, and a single status edit can land a commit containing
hundreds of deletions. That has already been misread as the PRD being
destroyed, and disproving it meant counting items by hand on both sides of the
commit (972 before, 972 after).

`serializeFolderTree` now reports what it did, and the folder-tree store prints
a one-line explanation when removals reach migration scale:

```
PRD tree layout changed: 762 stale path(s) removed after writing all 972 item(s)
in the document.
  Every item was written to its current path before any removal, so this is a
  re-layout (e.g. a slug-naming migration), not lost items.
  Expect a large rename diff — check the item count, not the file count.
```

The reassurance is structural rather than a guess: serialization writes every
item in the document to its current path *before* removing anything, so a
removed path is necessarily one no item occupies any more.

Two supporting corrections:

- `SerializeResult` gained `filesRemoved` and `itemsWritten`. Removals were
  only counted for directories, and a rename migration moves mostly leaf `.md`
  files — so the existing counter reported zero for exactly the churn that
  needed explaining.
- The module contract claimed "single-item mutations avoid full-tree
  re-serialization when possible". That is not what the code does: `addItem`,
  `updateItem` and `removeItem` all read-modify-write the whole document
  through `writeTree`. The documented contract now matches the implementation,
  including the consequence that a naming migration converges in one save.
