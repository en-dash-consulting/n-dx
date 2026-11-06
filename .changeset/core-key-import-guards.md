---
"@n-dx/core": patch
---

`ndx config credentials --import` (and its terminal prompt) no longer silently replaces a stored vendor key: a key the store already holds is only removed from `.n-dx.local.json`, and a different stored key is replaced only after a terminal confirmation naming both fingerprints. A git-tracked `.n-dx.local.json` is treated as repository config, so its keys are never moved into the user's store.
