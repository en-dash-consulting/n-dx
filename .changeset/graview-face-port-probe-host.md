---
"@n-dx/graview-face": patch
---

Test-only: the `bin/serve.js` port tests probe for a free port on the host they then hold, so a face left on `::1` by the previous test no longer collides with the next one on macOS CI. No runtime change.
