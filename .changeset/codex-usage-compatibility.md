---
"@n-dx/hench": patch
---

`n-dx work` preserves Codex JSON-summary and text usage reporting while counting resumed session counters only once.

Session protocol events retain cumulative accounting and reject unbounded resumed summaries. Partial observations preserve measured output deltas and recover missing input and cache counts from the session rollout when available. Historical records remain unchanged.
