---
"@n-dx/web": patch
---

Fix dashboard proposal acceptance silently dropping items. The
`/api/rex/proposals/accept` and `/api/rex/proposals/accept-edited`
handlers wrote new items via `savePRD` — which targets the legacy
`prd.md` + ephemeral cache — instead of the folder tree
(`.rex/prd_tree/`), the authoritative PRD surface per CLAUDE.md. The
folder-tree watcher then rebuilt the cache from the unchanged tree, so
accepted epics/features/tasks vanished with no error. Both handlers
now write through `resolveStore().addItem()` and refresh the cache
from the store so the dashboard sees the new items immediately.
