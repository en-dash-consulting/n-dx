---
id: "1fd545b9-b9d2-47a3-abc4-b492773aeed9"
level: "task"
title: "Workspace registry: one ServerContext, watcher set and PRD cache per worktree, lazily created, refreshed from git worktree list"
status: "completed"
priority: "high"
tags:
  - "pr-11"
  - "web"
blockedBy:
  - "351f574c-ae9f-4412-a7a9-899eec518607"
  - "e879c6ba-bcfe-4c76-821c-5972112bc49d"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-16T16:22:09.686Z"
completedAt: "2026-09-16T16:28:24.368Z"
endedAt: "2026-09-16T16:28:24.368Z"
resolutionType: "code-change"
resolutionDetail: "WorkspaceRegistry in src/server/workspaces.ts with lazy per-worktree ctx/watchers/PRD cache, 30 s + POST refresh from listWorktrees, header//w/ slot/anchor resolution wired into start.ts per request via a WorkspaceHooks seam; unit + two-worktree integration tests; anchor path unchanged and all web tests green."
acceptanceCriteria:
  - "Unit tests for the registry (lazy creation, refresh adds/removes worktrees, anchor never removed)."
  - "Integration test: two worktrees; editing a task in worktree B's tree updates B's cache and broadcasts, A's cache untouched."
  - "All existing web tests pass with the anchor as the only workspace."
description: "packages/web/src/server/workspaces.ts: WorkspaceRegistry(anchorDir) with get(key) → { ctx: ServerContext, watchers, prdCacheDir }, list(), refresh() (listWorktrees from PR 5; on a 30 s timer and on POST /api/workspaces/refresh); keys are worktree basenames (anchor = \"main\" or the main worktree's basename). Refactor start.ts so registerWatchers/refreshPRDCache/closeWatchers take a context and are invoked per workspace; the anchor keeps today's eager setup so boot time and the existing tests are unchanged. Request-scoped context: a resolveWorkspace(req) helper reads the /w/:wt/ slot (PR 12) or the X-Ndx-Workspace header and falls back to the anchor; until PR 12 lands every request resolves to the anchor."
lastModified: "2026-09-16T16:28:24.743Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
