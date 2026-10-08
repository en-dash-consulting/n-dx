---
"@n-dx/rex": patch
---

Schema v2 no longer stores a change's `commits`. They are now worked out from `N-DX-Item` trailers (both the permalink form and the bare id) on commits reachable from main. A rebase or squash changes a commit's SHA but keeps its trailer. The result is cached in rex's `.cache` directory. A `state.yaml` that still has `commits` still loads; the key is kept but ignored, and the new `retired-state-field` rule warns about it.
