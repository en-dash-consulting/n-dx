---
id: "34408a20-0fef-4025-8e44-921d1d881b5c"
level: "epic"
title: "0.6.0 / PR 5 · Worktree awareness in the dashboard (read-only)"
status: "pending"
priority: "high"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-05"
  - "web"
  - "llm-client"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "GET /api/worktrees lists every registered worktree with branch, dirty state, run counts and server presence."
  - "The Runs view shows runs from every worktree with a worktree badge."
  - "A Sessions panel shows each worktree's branch, dirty state, and running or last run."
description: "Release 0.6.0 (minor) · PR 5 of 7 · packages: @n-dx/web, @n-dx/llm-client · changeset: minor · after PR 1 and PR 2 have merged.\n\nProblem. Hench runs are written to the worktree where `ndx work` ran (.hench/runs is untracked), so a dashboard served from the main checkout shows none of the sessions running in .claude/worktrees/*. The only worktree-aware code is listNestedWorktrees() in packages/sourcevision/src/analyzers/workspace.ts (~line 100), which uses `git worktree list --porcelain` purely to exclude nested checkouts from analysis.\n\nGoal. The served dashboard can list the repo's worktrees and show their runs and state without any write path or routing change. This is the read-only half of the 0.8.0 workspace model.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:11:55.869Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add listWorktrees(cwd) to llm-client and re-export it through the web and hench gateways](./add-listworktrees-cwd-to-llm-client.md) | pending |
| [GET /api/worktrees: the served repo's worktrees with branch, head, dirty, run counts and server presence](./get-api-worktrees-the-served-repo-s.md) | pending |
| [Hench Runs view aggregates .hench/runs across worktrees with a worktree badge](./hench-runs-view-aggregates-hench-runs.md) | pending |
| [Sessions panel: each worktree with branch, dirty state, and running or last run](./sessions-panel-each-worktree-with.md) | pending |
