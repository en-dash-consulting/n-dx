---
"@n-dx/core": patch
"@n-dx/sourcevision": patch
---

`ndx init` now leaves a clean tree so `ndx work` can start straight after it. In an existing git repository it commits the paths it owns under the project directory that it created or changed, plus any sourcevision output, with the n-dx trailers and without running the project's commit hooks; anything else that changed meanwhile is never committed, init paths the user had already changed are left as they were and listed in the summary, a re-init commits only what it rewrote (no empty commit), and `--no-commit` skips the commit. The hub card's Initialize runs the same path. Init now gitignores the dashboard's pid, port and spend files and the analysis caches, and drops any of them an earlier commit tracked (they stay on disk). The baseline commit after `git init` now includes `.gitattributes` and `.mcp.json` and skips paths the user's global excludes ignore instead of failing.
