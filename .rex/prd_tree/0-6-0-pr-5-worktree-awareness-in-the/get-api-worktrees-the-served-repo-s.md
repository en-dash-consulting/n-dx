---
id: "271a28ee-10dc-41d3-9e35-5f10571cbcfe"
level: "task"
title: "GET /api/worktrees: the served repo's worktrees with branch, head, dirty, run counts and server presence"
status: "pending"
priority: "high"
tags:
  - "pr-05"
  - "web"
blockedBy:
  - "351f574c-ae9f-4412-a7a9-899eec518607"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Route returns the expected shape for a temp repo with two worktrees and one run file each (integration test)."
  - "GET /api/projects is removed along with detectProjects and its unit test; nothing in the viewer referenced it."
description: "New route module packages/web/src/server/routes-worktrees.ts registered in start.ts's API dispatch. For the served projectDir: listWorktrees(projectDir); for each worktree: branch, head, isAnchor (isMain), dirty (git status --porcelain count, 5 s timeout, best-effort), runs { total, running, lastFinishedAt } by reading <wt>/.hench/runs/*.json (reuse loadRunFile logic from routes-hench.ts, keep it cheap: stat + parse status only), server { pidFile present, port } from <wt>/.n-dx-web.port/.pid. Cache the whole answer for 5 s. Return [] with 200 when not a git repo. Retire the half-built sibling scan in routes-config.ts (GET /api/projects, detectProjects) in the same PR: remove it and its test, since the hub registry replaces it in 0.7.0."
lastModified: "2026-09-10T20:11:58.189Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
