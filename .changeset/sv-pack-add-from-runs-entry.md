---
"@n-dx/sourcevision": patch
---

`sv pack --help` and the sourcevision docs now say that `sv pack add --from` runs the bundle's entry module while validating it, before anything is installed, so only bundles from a trusted source should be added.
