---
"@n-dx/rex": patch
---

A change new to the tree that arrives with its own `lastModified` (an import or a migration) now takes it as `createdAt`, so it no longer reads as created today in `rex change inbox` and on the Inbox rows.
