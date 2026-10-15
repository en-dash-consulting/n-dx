---
"@n-dx/web": patch
---

The MCP schema watchers on the `dist/` folders of `@n-dx/rex` and
`@n-dx/sourcevision` now handle a watcher error: it is logged, the watcher is
closed and dropped, and `ndx start` keeps serving instead of crashing when a
rebuild or `pnpm install` removes a watched `dist/`.
