---
"@n-dx/hench": patch
---

The leftover-work checks discount a copy into `.rex/` by its target again, since a copy leaves its source in place; only a rename must match on both sides. A refused rename whose source contains ` -> ` is now named in full.
