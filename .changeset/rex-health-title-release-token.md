---
"@n-dx/rex": patch
---

`rex health` on a v2 tree now passes the project's releases (package.json version, every `plannedRelease` and `shippedIn`) to the tree rules, so `title-release-token` flags a change titled with one of them. A dependency version that is not a project release is still not flagged.
