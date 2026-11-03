---
"@n-dx/rex": patch
---

The v2 isolation test resolves every relative import (static, side-effect and dynamic `import()`) against the set of v2 modules instead of matching a hand-kept name pattern, so an import of a core v2 module such as `core/apply-amendments.js` is reported. The v2 module set now also holds the state merge, the v2 bundle, the change-layer store, next-task selection, the release stamp, the layer projection, change add and place, and every `migrations/v1-to-v2/` module, so a new v1 file importing any of them fails the test. The existing callers it now sees are listed as wired.
