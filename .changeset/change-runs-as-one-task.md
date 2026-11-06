---
"@n-dx/web": patch
---

A v2 change with no tasks runs as one task on the dashboard: its detail panel offers Start, run history and usage, saving its run settings succeeds, and the Changes view reads "runs as one task". The server marks such a change `runsAsOneTask` from rex's selection rule; a change with tasks, or one holding a change, still refuses run settings.
