---
"@n-dx/core": patch
---

An extension approval now covers only the copy approved: its source and the real path of its package directory are part of it, so a same-named, same-version package elsewhere asks again. A project that installs `@n-dx/core` itself no longer has its `node_modules` treated as the global extension source, while n-dx installed globally with npm, pnpm (with or without `PNPM_HOME`), yarn classic or bun still finds global extensions; `ndx extensions doctor` notes when no global source was recognised.
