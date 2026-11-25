---
"@n-dx/sourcevision": patch
"@n-dx/lang-runtime": patch
"@n-dx/lang-kit": patch
---

`imports.json` `summary.parseIssues` now has an entry for every language pack that ran, with zero counts when it parsed every file cleanly.

A pack that did not run has no entry, and the field is absent only in analyses made before it existed or when no pack ran. A tree-sitter pack's `parse` report is now returned on every run that is not degraded, with empty lists when all files are clean. A clean parse prints no `[<pack>-parse]` line, as before.
