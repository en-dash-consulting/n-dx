---
"@n-dx/rex": patch
---

Change-commit lookup defaults to origin/HEAD, then origin/main, then main, so a CI checkout without a local main and a clone with a stale local main both resolve.
