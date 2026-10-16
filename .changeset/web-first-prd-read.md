---
"@n-dx/web": patch
---

The first `/api/rex/prd` read after `ndx start` no longer answers 404 on a folder tree: the boot PRD cache is written before the server listens, so a request cannot beat it.
