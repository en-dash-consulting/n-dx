---
"@n-dx/core": patch
---

`ndx config` writes `.n-dx.local.json` through an owner-only (0600) temp file renamed into place, so the file never exists at the default umask, and checks git before writing an API key: a tracked target is refused, an unignored one is warned about.
