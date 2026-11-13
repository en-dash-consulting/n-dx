---
"@n-dx/hench": patch
---

`hench run --epic-by-epic --epic=<id>` now reports the flag conflict even when the project has no PRD folder. Flag-only refusals run before the config and PRD-folder checks.
