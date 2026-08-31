---
"@n-dx/core": patch
---

Add `.hench/reviews/` to the `ndx init` ignore template, and retire its stale
`.rex/prd.json.lock` entry.

The adversarial-review pass writes `.hench/reviews/<run-id>.json`, and hench's
pre-run gate commits with `git add -A`, so a project that pasted the template
into its `.gitignore` would commit machine-local review reports on the next
run. The template also still named `.rex/prd.json.lock`, which `FileStore`
stopped writing once both stores moved to `prdLockPath()` — now `.rex/*.lock`,
which covers the folder-tree lock that is actually created.

Nothing tested the template, which is how both entries drifted. It is now
pinned against this repo's own `.gitignore`, so a runtime artifact added on one
side and missed on the other fails a test instead of shipping.
