---
id: "bd59cce9-c36e-43ce-9b73-525ff2a30282"
level: "epic"
title: "0.6.0 / PR 6 · Cross-worktree task claims (may slip to 0.7.0)"
status: "pending"
priority: "high"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-06"
  - "rex"
  - "hench"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Two worktrees running `ndx work --auto` never start the same task."
  - "Stale claims (dead pid or expired) are ignored and cleaned up."
  - "Claimed tasks are visible in the dashboard with the claiming worktree."
description: "Release 0.6.0 (minor, may slip to 0.7.0 without blocking the release) · PR 6 of 7 · packages: @n-dx/rex, @n-dx/hench, @n-dx/web · changeset: minor · after PR 2.\n\nProblem. Nothing prevents two worktrees from picking the same task: get_next_task reads the branch's copy of .rex/prd_tree, hench's ProcessLimiter lock files live in each checkout's .hench/locks, and the dashboard's activeExecutions map (packages/web/src/server/routes-hench.ts ~line 1010) only sees its own children.\n\nGoal. A claim visible from every worktree of a repository, stored in the git common dir (`git rev-parse --git-common-dir`, e.g. .git/ndx/claims.json), so that task selection anywhere in the repo skips tasks another worktree is working on. Outside a git repo, behaviour is unchanged.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:12:02.259Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Claims store in the git common dir: .git/ndx/claims.json with pid, worktree, task id and expiry](./claims-store-in-the-git-common-dir-git.md) | pending |
| [Dashboard shows claimed tasks with the claiming worktree in the PRD tree and the Sessions panel](./dashboard-shows-claimed-tasks-with-the.md) | pending |
| [ndx work claims the task before starting and releases on finish; get_next_task and hench selection skip live claims](./ndx-work-claims-the-task-before.md) | pending |
