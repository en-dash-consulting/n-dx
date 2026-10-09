---
"@n-dx/rex": patch
---

Add `rex release stamp <version>`: stamps `shippedIn` on every finished change that has landed on main since the last release tag, reading git only (tags, ancestry, `N-DX-Item` trailers), so any CI can run it. Under `rex.applyOn: release` it first applies completed changes to the product layer. A stamped change is never restamped. On a v1 tree it prints that there is nothing to stamp and exits 0. n-dx's Version Packages step now runs it and continues with a warning if it fails.
