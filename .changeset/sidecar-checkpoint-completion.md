---
"@n-dx/web": patch
---

Sidecar (experimental, off by default; enable with `web.sidecar`) shows a checkpoint diagnostic and starts the next turn with fresh context when checkpointing fails.

Any measured checkpoint usage spent is recorded once, including usage from a checkpoint that started but failed. Checkpoint failures show a diagnostic and mark the next turn for fresh context, whatever the cause.
