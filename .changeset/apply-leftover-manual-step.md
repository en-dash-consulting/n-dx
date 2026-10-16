---
"@n-dx/rex": patch
---

`migrate --apply`: every leftover `prd_tree/` message now names the leftover and the same manual step (check the v2 tree holds everything in it, then delete it by hand). A failed removal after the switch no longer promises a re-run finishes the job, and a failed removal on an already-v2 apply says the v2 tree is in place instead of throwing the raw error.
