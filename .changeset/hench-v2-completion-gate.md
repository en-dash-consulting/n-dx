---
"@n-dx/hench": patch
---

On a v2 tree, hench's completion gate and save-report staging treat `product/` and `changes/` (`state.yaml` included) as PRD bookkeeping, as they do `prd_tree/` on v1. The review pass checks `changes/` for an existing item before filing a duplicate. The agent's rex allowlist adds `get_capability` and `place_change`; `apply_change` stays operator-only.
