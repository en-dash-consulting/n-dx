---
"@n-dx/hench": patch
"@n-dx/web": patch
---

Route hench's and the web dashboard's own `.rex`/`.hench`/`.sourcevision` file access through the folder-layout resolver instead of hardcoded paths.

On a project that has migrated to the `.ndx/` container layout, several hench and web code paths previously composed `join(projectDir, ".hench", …)` / `.rex` / `.sourcevision` directly — the sourcevision primer and analysis-fingerprint reads, the retention-log and quota reads, hench's recovery pathspec files, the dashboard's server startup (`ctx.rexDir`/`ctx.svDir`), workspace (worktree) context construction, the worktree run-history route, the aggregation cache's fingerprint sources, the merge graph, token-usage analytics, the usage-cleanup scheduler, and the config/status/commands routes. On `.ndx/` projects these read and wrote nothing, silently: no primer, no fingerprint, no worktree runs, and the dashboard's "initialized" check never turned true. They now resolve through `resolveLayout`/`resolveHenchPaths`/`resolveWebPaths`, so both layouts work identically.
