---
"@n-dx/core": patch
---

Ship `gitignore.js` in the published `@n-dx/core` tarball.

`cli.js` and `export.js` import `./gitignore.js` (the shared
`ensureGitignoreEntry` helper), but the file was missing from `package.json`'s
`files` array, so an installed `@n-dx/core` would fail to load those modules.
Added it to `files`; `published-imports-resolved` now passes.
