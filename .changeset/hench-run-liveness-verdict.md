---
"@n-dx/hench": patch
---

Add `process/run-liveness.ts`: one verdict (`live`, `foreign`, `unknown`, `orphaned`) on whether a run recorded as running is actually executing, judged from the run's host, its recorded pid and heartbeat, and `.hench/locks/` for records without a pid. EPERM from the pid probe counts as alive.
