---
"@n-dx/core": patch
"@n-dx/web": patch
---

n-dx recovers from a stale build itself instead of telling you to rebuild. On a source-linked checkout, `ndx start` (hub, `--here` and `--preview`) rebuilds `@n-dx/web` and the workspace packages it depends on when its `dist/` is older than its source, says so, and then spawns; a command whose package `dist/` is missing builds it and runs; `ndx export` builds a missing viewer. A failed automatic build exits non-zero with the build's own output. A published install missing a built file says it is incomplete and to reinstall.
