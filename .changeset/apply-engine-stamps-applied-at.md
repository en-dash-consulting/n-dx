---
"@n-dx/rex": patch
---

The v2 apply engine now stamps `appliedAt` (a timestamp the caller passes) instead of `appliedIn`, refuses an already applied change by `appliedAt`, and takes no commit option. A completed but unapplied product-edit draft counts as open, as in the v2 rules.
