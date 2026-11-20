---
"@n-dx/hench": patch
---

`n-dx work` reports failed Codex continuations with the actual attempt count and describes truncated sessions as unfinished.

Failed continuations stop without claiming the configured retry budget was exhausted. Cancellation, timeout and other run bounds retain their existing outcomes.
