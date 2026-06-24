---
"@n-dx/core": patch
---

Fix `ndx ci` on Windows: pnpm is a `.cmd` shim and requires `shell: true` to resolve without ENOENT. Add `shell: process.platform === "win32"` to the docs-build spawn in `ci.js`.
