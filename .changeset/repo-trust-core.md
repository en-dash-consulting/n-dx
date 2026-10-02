---
"@n-dx/core": patch
---

`ndx init` ends with a review of what the checkout shipped as execution config and what else came with it (PRD items, analysis, run records), and asks whether to trust it; unattended inits never trust automatically. New `ndx trust [status|accept|revoke] [dir]` command, delegating to `hench trust`.
