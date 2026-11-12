---
"@n-dx/web": patch
---

Sidecar (experimental, off by default; enable with `web.sidecar`) keeps delivered answers completed when checkpointing fails, preserves measured spend, and shows a diagnostic before cold recovery.

Successful checkpoint usage remains included once. Refused checkpoint spawns or unreadable configuration preserve the answer and mark the next turn to start with fresh context after configuration is repaired.
