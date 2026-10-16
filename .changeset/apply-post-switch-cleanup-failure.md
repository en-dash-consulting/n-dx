---
"@n-dx/rex": patch
---

`migrate --apply`: when removing `prd_tree/` or `tree-meta.json` fails after the v2 tree is switched in (a handle held on Windows), apply now says the v2 tree is in place, names the leftovers and the underlying error, and asks for `ndx migrate --apply` to be run again, instead of throwing the raw error.
