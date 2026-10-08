---
"@n-dx/rex": patch
---

Change-commit lookup refuses a shallow clone with an error naming `git fetch --unshallow` and `fetch-depth: 0`, instead of returning a truncated commit list.
