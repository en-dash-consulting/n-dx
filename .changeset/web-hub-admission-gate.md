---
"@n-dx/web": minor
---

The hub now admits dashboard-started agent runs against machine-wide limits instead of letting every project start its own. A run is forwarded when fewer than `hub.maxSessions` are in flight across all registered projects and free memory is above `hub.memoryFloorBytes`; otherwise it is queued FIFO and answered `202 { queued: true, position }` rather than refused, and released when capacity frees. `~/.n-dx/config.json` gains `hub.maxSessions` (default 4) and `hub.memoryFloorBytes` (default 2 GiB), with every unusable key named once at hub start and falling back to its default rather than stopping the hub. `GET /api/hub/queue` reports the limits, what is running, what is waiting, and whether admission is paused for low memory.
