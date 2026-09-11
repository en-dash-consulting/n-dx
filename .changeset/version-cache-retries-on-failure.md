---
"@n-dx/web": patch
---

fix(web): retry readWebVersion() after a transient read failure

`readWebVersion()` (used by GET /api/status and GET /api/config's `server`
object) memoized its own failure: a read of `packages/web/package.json`
that fails transiently — EMFILE under descriptor pressure, a slow mount not
yet ready during a startup burst — assigned the sentinel `"unknown"` to the
module-level cache, and the truthy check on re-entry then returned
`"unknown"` for the life of the process even once the file was readable
again.

The catch path now returns `"unknown"` without populating the cache, so the
next call retries. A successful read is still memoized permanently, since
the file does not change under a running process.
