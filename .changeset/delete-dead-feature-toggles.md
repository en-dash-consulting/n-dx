---
"@n-dx/web": patch
"@n-dx/core": patch
---

Settings › Project no longer lists eight feature toggles that nothing read: call graph, enrichment, component catalog, parent auto-complete, budget enforcement, auto-retry, guard rails and adaptive workflow.

Switching them never changed anything. The call graph and component catalog are built on every analysis, enrichment follows the analyze mode, parents always auto-complete, and guard rails are always on. Budget enforcement and adaptive workflow were never built. `PUT /api/features` now refuses the eight keys as unknown, and `ndx config --help` and the static export no longer name them. A `.n-dx.json` that still stores one loads as before, and the stored value is ignored, as it always was.
