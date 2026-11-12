---
"@n-dx/web": patch
---

A v2 change with no tasks offers `Start`, run history, usage and saved run settings on the dashboard.

The Changes view reads "runs as one task". The server marks such a change `runsAsOneTask` from rex's selection rule; a change with tasks, or one holding a change, still refuses run settings.
