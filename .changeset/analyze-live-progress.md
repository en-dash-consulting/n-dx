---
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

A running `sv analyze` now publishes structured progress to `.sourcevision/.cache/analyze-progress.json`: mode, current phase and every phase's start and end, the enrichment pass, its batch k of n, judgment-cache hits and misses, and LLM calls, tokens and time per task class so far. The file is marked complete or failed when the run ends, and a file whose process has died reads as `interrupted`, never `running`. `GET /api/commands/sv-analyze/status` gains a `progress` field with that report and the previous same-mode run's per-phase timings, for terminal- and dashboard-started runs alike, and the server pushes an `sv:analyze-progress` WebSocket frame within about a second of each change.
