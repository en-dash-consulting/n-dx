---
"@n-dx/core": patch
---

Fix `ndx` binary crashing on npm install due to missing files in the published tarball

- `packages/core/package.json` `files` array was missing `assistant-integration.js` and `codex-integration.js`
- `cli.js` statically imports `assistant-integration.js`, which in turn statically imports `codex-integration.js`, so the resolution failure happened at module load before any error handling could run
- Verified via `npm pack --dry-run`: tarball now ships 25 files, and the transitive static-import graph from `cli.js` resolves cleanly
