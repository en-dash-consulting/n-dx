---
"@n-dx/web": minor
---

Workspace-tagged WebSocket frames and the breadcrumb workspace switcher. Every broadcast now carries `{ workspace: <key> }` — watchers and routes stamp the workspace they act on, process-wide monitors stamp `"*"` — and the viewer drops frames for another workspace (untagged frames read as the anchor's), so a change in one worktree no longer makes a tab on another refetch. The breadcrumb's branch chip is now a keyboard-accessible listbox of every worktree with the anchor starred, a pulse for running work, elapsed time since the last run and the dirty-file count; choosing one opens the same view under `/w/<key>/`, and a footer links to the Workspaces overview.
