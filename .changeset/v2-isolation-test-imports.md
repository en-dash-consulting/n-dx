---
"@n-dx/rex": patch
---

The v2 isolation test resolves every relative import (static, side-effect and dynamic `import()`) against the set of v2 modules instead of matching a hand-kept name pattern, so an import of a core v2 module such as `core/apply-amendments.js` is reported. The existing callers it now sees are listed as wired.
