---
"@n-dx/core": patch
---

Identifying the hub's listener no longer needs `lsof` on Linux: it falls back to `ss -ltnp`, then to `/proc/net/tcp` and `/proc/<pid>/fd`. A listening socket whose owner cannot be seen is refused, and when no query tool is installed the error names the missing ones. `ndx start` now says why a hub it spawned was not identified instead of only reporting that it did not start.
