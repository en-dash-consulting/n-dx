---
"@n-dx/core": patch
---

`ndx extensions remove <name> --purge` now keeps `<ndx home>/ext/<name>/` when a global or dev-path copy of the same extension was shadowed by the removed user copy, and says which copy now applies. Before this fix, the purge deleted the state folder the remaining copy went on to use.
