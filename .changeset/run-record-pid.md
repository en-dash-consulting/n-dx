---
"@n-dx/hench": patch
"@n-dx/web": patch
---

Record the agent process pid on every run record.

Hench now writes `pid` (its own process) and `vendorPid` (the vendor CLI subprocess while one is live) to the run record when the run starts, and the existing 30-second heartbeat refreshes them. Both are additive optional fields; records without them load normally and mean "pid unknown".

`GET /api/hench/runs/health` reports `pid`, `vendorPid` and `pidAlive` beside the heartbeat age, so a slow run (old heartbeat, pid alive) can be told from a dead one (pid gone) whoever started it. `pidAlive` is `null` when no pid was recorded.
