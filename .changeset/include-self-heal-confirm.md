---
"@n-dx/core": patch
---

Fix: include `self-heal-confirm.js` in the published `@n-dx/core` tarball.
The file exists in source and is imported by `cli.js` (line 50), but was
missing from `package.json`'s `files` array, so 0.4.3 published without
it and `ndx` crashed at startup with
`ERR_MODULE_NOT_FOUND: Cannot find module … self-heal-confirm.js`.

Because the changeset config groups all six `@n-dx/*` packages as
`fixed`, this patch bumps the whole set to 0.4.4 — the other five
packages republish unchanged but at the new version.
