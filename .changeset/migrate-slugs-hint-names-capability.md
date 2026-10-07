---
"@n-dx/rex": patch
---

`rex migrate-slugs` now names the condition it actually checked when it refuses. The hint claimed the resolved store "is a remote adapter with no paths to rename", which was never the test and describes a backend kind that no longer exists; the guard checks whether the store implements `adoptSlugRule`, so that is what it now says.
