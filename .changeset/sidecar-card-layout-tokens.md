---
"@n-dx/web": patch
---

Sidecar command cards expand layout tokens in the effects line. `ndx status` now reads `.rex/product/ and .rex/changes/` instead of `{prdRead}`, using the `layoutPaths` that `GET /api/commands/manifest` serves; a token the manifest does not name is left as written.
