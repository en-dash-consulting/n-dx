---
"@n-dx/core": patch
---

An extension approval now covers only the copy approved: its source and the real path of its package directory are part of it, so a same-named, same-version package elsewhere asks again. A project that installs `@n-dx/core` itself no longer has its `node_modules` treated as the global extension source.
