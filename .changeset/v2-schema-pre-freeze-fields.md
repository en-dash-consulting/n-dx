---
"@n-dx/rex": patch
---

Add the v2 PRD schema fields decided before the freeze, all optional: `fix` on a change; `type` (capability or constraint) and `base` (the target's spec hash when drafted) on an amendment; `commit` on a check result; `reviewedHash` on product-node state, replacing `specReviewed`; and `appliedAt` and `appliedAmendsHash` on change state, replacing `appliedIn`. `appliedIn` and `specReviewed` are retired: an older `state.yaml` that still has them loads and keeps them unconverted, and a new `retired-state-field` warning rule reports them. `unreviewed-spec` now compares `reviewedHash` with the current spec hash. v2 is still not wired to the store.
