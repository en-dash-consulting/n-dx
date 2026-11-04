---
"@n-dx/core": patch
"@n-dx/sourcevision": patch
---

`ndx init` now leaves a clean tree so `ndx work` can start straight after it. In an existing git repository it commits exactly the paths it created or changed, plus any sourcevision output, with the n-dx trailers; the user's other changes are left out of the commit and keep their state, a re-init commits only what it rewrote (no empty commit), and `--no-commit` skips the commit. The hub card's Initialize runs the same path. Init now gitignores the dashboard's pid, port and spend files and the analysis caches, and drops any of them an earlier commit tracked (they stay on disk). The baseline commit after `git init` now includes `.gitattributes` and `.mcp.json` and skips paths the user's global excludes ignore instead of failing.
