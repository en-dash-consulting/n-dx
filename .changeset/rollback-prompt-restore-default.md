---
"@n-dx/hench": patch
---

The failed-run rollback prompt now names the dirty files and says they are hench's own status writes from this run, and defaults to Yes so a bare Enter reverts and restores the pre-run PRD state — leaving them in place, not reverting, was the actual damage. An explicit `n`/`no` is required to keep the dirty files.
