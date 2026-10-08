---
"@n-dx/rex": patch
---

The v2 apply engine stamps `appliedAmendsHash` and reports an applied change whose amends were edited afterwards, refuses an amendment whose `base` no longer matches its target's spec (unless forced), refuses a result that breaks a v2 rule the input did not, creates a constraint for an added amendment with `type: "constraint"`, and clears the change's `needsPlacement`. Product-edit drafts record `base`.
