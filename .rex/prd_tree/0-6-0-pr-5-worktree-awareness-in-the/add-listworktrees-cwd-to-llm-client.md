---
id: "351f574c-ae9f-4412-a7a9-899eec518607"
level: "task"
title: "Add listWorktrees(cwd) to llm-client and re-export it through the web and hench gateways"
status: "completed"
priority: "high"
tags:
  - "pr-05"
  - "llm-client"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-14T03:11:35.790Z"
completedAt: "2026-09-14T03:22:42.804Z"
endedAt: "2026-09-14T03:22:42.804Z"
resolutionType: "code-change"
resolutionDetail: "Async listWorktrees + WorktreeInfo in llm-client exec.ts (porcelain parsing, realpath'd paths, [] degradation, 5s ceiling, quiet stderr), exported via public.ts and hench's llm-gateway (cap 164→166, both contract registries updated); web uses the ungated public barrel by design; unit tests against real repos cover all five acceptance scenarios. Commit 2bc2580a on feat/hub-daemon-skeleton."
acceptanceCriteria:
  - "Unit tests: main only, main + linked worktrees, detached worktree, non-repo, git missing."
  - "domain-isolation and architecture-policy tests pass unchanged."
description: "packages/llm-client/src/exec.ts: listWorktrees(cwd) → Array<{ path, branch|null, head, isMain, detached, bare }> by parsing `git worktree list --porcelain` (path lines, HEAD, branch refs/heads/*, detached, bare), paths realpath-resolved, [] when git is missing or cwd is not a repo, 5 s timeout, no stderr spew. Provide an async version (the exec helpers are Promise-based) and keep the sourcevision analyzer's synchronous copy in workspace.ts untouched (it must stay synchronous and is already allowlisted in tests/e2e/architecture-policy.test.js). Re-export through packages/web/src/server's llm-client import surface and packages/hench/src/prd/llm-gateway.ts."
lastModified: "2026-09-14T03:22:42.834Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
