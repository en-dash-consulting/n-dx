---
"@n-dx/rex": patch
---

`add_item` (v2 change with `amends`) and `place_change` (relation `amends`) now dry-run `apply_change` before they store an amendment. If apply would refuse it, they refuse with apply's own message and write nothing. This covers, for example, a criteria delta on a constraint, `criteria.replace` or `criteria.remove` on a capability the same change adds, and criterion ids that do not fit the capability. A stale `base` and a summary-only placement are still accepted.
