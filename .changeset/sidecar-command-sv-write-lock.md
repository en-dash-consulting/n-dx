---
"@n-dx/web": patch
---

A Sidecar `ndx` command that writes `.sourcevision/` (analyze, ci, refresh, and any other command whose declared effects say so) now takes the dashboard's `.sourcevision` write lock. It is refused while the dashboard's analyze, CI or refresh runs, and they are refused while it runs.
