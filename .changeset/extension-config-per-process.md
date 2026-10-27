---
"@n-dx/core": patch
---

Each `ndx <extension>` run gets its own `NDX_EXTENSION_CONFIG` file, written whole and removed when the command exits, so concurrent runs in different projects no longer read each other's config. A sidecar gets the user's section alone in `sidecar-config.json`, which command runs never touch.
