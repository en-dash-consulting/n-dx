---
id: "592e5c5f-8007-4fb3-860e-9eb4ee37e760"
level: "feature"
title: "Workspace-tagged WebSocket frames with client-side filtering, and the breadcrumb workspace switcher"
status: "completed"
priority: "high"
tags:
  - "pr-12"
  - "web"
blockedBy:
  - "fe40eba6-bc8e-4d12-9b5f-f91389f3a0ca"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-16T16:52:42.802Z"
completedAt: "2026-09-16T17:00:48.015Z"
endedAt: "2026-09-16T17:00:48.015Z"
resolutionType: "code-change"
resolutionDetail: "Broadcasts are tagged per workspace (\"*\" for process-wide), the viewer pipeline and raw consumers drop foreign frames (untagged = anchor), and the breadcrumb branch chip is a keyboard-accessible worktree listbox that navigates to /w/<key>/<view>; unit tests for tagging, filtering and the switcher, integration asserts the tag."
acceptanceCriteria:
  - "Two tabs on different workspaces: a change in one does not refetch the other."
  - "Switcher renders, navigates, and is reachable by keyboard; unit tests for the dropdown and for frame filtering."
description: "Server: every broadcast from a workspace's watchers and routes includes { workspace: <key> } (websocket.ts broadcast gains an optional tag; the hub (PR 8) passes frames through). Viewer: use-prd-websocket.ts and the other consumers (hench:run-changed, hench:task-execution-progress, sv:data-changed, commands:*) ignore frames tagged for another workspace; untagged frames (older servers) are treated as anchor. Breadcrumb (packages/web/src/viewer/components/breadcrumb.ts): the branch chip becomes a button showing \"<worktree> · <branch>\" with a caret; the dropdown lists every worktree from GET /api/worktrees with anchor star, running pulse and elapsed time, dirty count, and a footer link \"Open Workspaces overview\" (PR 13); selecting one navigates to /w/<key>/<current view>. Match breadcrumb.css tokens; keyboard and screen-reader accessible (listbox semantics)."
lastModified: "2026-09-16T17:00:48.393Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
