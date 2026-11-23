---
"@n-dx/lang-kit": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Internal: the pack contract gains language-neutral `configReads` and `flagChecks` fact kinds, and `sv analyze` writes them to a new `config.json` when a pack produces them.

No pack produces them yet, so every analysis is unchanged and writes no `config.json`. The facts record keys, flag names, files, positions and the lines a flag check gates, never a value; `normalizeFlagName` gives one flag's spellings one name. The dashboard's data-file list names `config.json` so it is served and watched once it exists.
