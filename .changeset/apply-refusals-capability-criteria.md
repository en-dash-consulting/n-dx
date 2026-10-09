---
"@n-dx/rex": patch
---

`rex change apply`, `add_item` and `place_change` now refuse a criteria delta on a constraint, or a replace/remove on a new capability, with "has no capability criteria" instead of a bare "criteria".
