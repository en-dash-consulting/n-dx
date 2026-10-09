---
"@n-dx/rex": patch
---

`add_item` on a v2 tree refuses a `modified` amendment whose criteria delta does not fit the target capability (removing or replacing an id it lacks, adding one it has), as `apply_change` would, and writes nothing.
