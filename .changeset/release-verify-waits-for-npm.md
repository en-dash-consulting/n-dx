---
"@n-dx/core": patch
---

The release workflow's verify step no longer skips when npm has not caught up.
It decides whether the run published from the changesets action's `published`
output, waits with a bounded backoff for every package to appear on npm, and
fails with a clear error if one never does. `child-process-allowlist.json` lists
the new `scripts/verify-release-sync.mjs`, which drives `npm`, `git` and `gh`.
