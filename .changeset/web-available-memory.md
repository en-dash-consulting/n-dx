---
"@n-dx/web": patch
---

The dashboard's memory status and the hub's admission floor now use the shared available-memory reading from `@n-dx/llm-client` instead of `os.freemem()`. On macOS that counts the inactive, speculative and purgeable pages the OS hands back on demand, so a healthy 16 GB Mac that read 115 MB free (dashboard "critical" at 99% used, and below the hub's 2 GB floor, which queued every dashboard-started run) now reads the ~3.9 GB it can actually give out and starts the run. Linux and Windows are unchanged — `os.freemem()` is already the available figure there.

`GET /api/hench/memory` keeps its fields and adds `system.availableBytes`, `system.pressure` and `system.source`; `system.freeBytes` carries the available reading. A machine whose memory cannot be read at all reports health `"unknown"` with `freeBytes`, `usedBytes` and `usedPercent` null, the memory panel shows a dash and "Memory reading unavailable" with no warning styling, and the hub admits rather than queuing — nothing flags, throttles or holds a run on a reading that does not exist. The hub's queue snapshot gains `availableBytes` and `pressure`, and the panel and queue copy now say "available" rather than "free".
