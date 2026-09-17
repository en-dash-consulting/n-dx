---
"@n-dx/web": patch
---

Build lazily-created workspace contexts' `svDir`/`rexDir` with `path.join` instead of `/` string concatenation, so non-anchor worktree paths use native separators on Windows (the PRD lock and store resolution key off `rexDir`, where a mixed-separator spelling risks cache and lock misses).
