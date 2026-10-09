---
"@n-dx/rex": patch
---

v2 changes take an optional, typed `acceptanceCriteria` list ("done when" for the change's own work), the same shape as a task's. The split rule moves it to a task-less change's first task. It never feeds the spec hash or product status, which read only a capability's capability criteria.
