---
"@n-dx/web": patch
---

`GET /api/hench/ready` now orders tasks as `ndx work --auto` picks them: a task with `maxFailedAttempts` consecutive hard failures in `.hench/runs` is left out, and its dependents are offered as if it were done.
