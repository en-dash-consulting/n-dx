---
"@n-dx/hench": patch
"@n-dx/rex": patch
---

`n-dx work` counts resumed Codex usage once and skips assisted bookkeeping inside managed execution and review.

Cumulative session counters are converted to fresh-input, cache and output deltas before run and review accounting. Missing boundaries, resets and identity mismatches retain measurement diagnostics; usage rollups preserve partial or unavailable provenance. Standalone assisted marks and nested records keep their existing behavior. Historical run records are unchanged.
