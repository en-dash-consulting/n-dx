---
id: "351f574c-ae9f-4412-a7a9-899eec518607"
level: "feature"
title: "Add listWorktrees(cwd) to llm-client and re-export it through the web and hench gateways"
status: "completed"
priority: "high"
tags:
  - "pr-05"
  - "llm-client"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-16T13:41:01.178Z"
completedAt: "2026-09-16T13:43:27.146Z"
endedAt: "2026-09-16T13:43:27.146Z"
resolutionType: "code-change"
resolutionDetail: "listWorktrees(cwd) added to @n-dx/llm-client exec.ts, exported publicly and via hench llm-gateway; unit + real-git integration tests; policy suites green."
acceptanceCriteria:
  - "Unit tests: main only, main + linked worktrees, detached worktree, non-repo, git missing."
  - "domain-isolation and architecture-policy tests pass unchanged."
description: "packages/llm-client/src/exec.ts: listWorktrees(cwd) → Array<{ path, branch|null, head, isMain, detached, bare }> by parsing `git worktree list --porcelain` (path lines, HEAD, branch refs/heads/*, detached, bare), paths realpath-resolved, [] when git is missing or cwd is not a repo, 5 s timeout, no stderr spew. Provide an async version (the exec helpers are Promise-based) and keep the sourcevision analyzer's synchronous copy in workspace.ts untouched (it must stay synchronous and is already allowlisted in tests/e2e/architecture-policy.test.js). Re-export through packages/web/src/server's llm-client import surface and packages/hench/src/prd/llm-gateway.ts."
lastModified: "2026-09-16T13:43:27.524Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
