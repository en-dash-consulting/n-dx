---
"@n-dx/graview": patch
---

Make the `graview.app` trust test independent of `NDX_CLI_PATH`, so it no longer fails when run under `ndx work`, which exports the runner to its test gate.
