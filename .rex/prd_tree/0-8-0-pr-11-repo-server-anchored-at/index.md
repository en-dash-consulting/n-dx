---
id: "3ca4dccd-03b5-4df1-8803-3ff2173f71bb"
level: "epic"
title: "0.8.0 / PR 11 · Repo server anchored at the main worktree with one context per worktree"
status: "pending"
priority: "high"
tags:
  - "parallel-dev"
  - "release-0.8.0"
  - "pr-11"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "A workspace registry keyed by worktree path exposes GET /api/workspaces and creates a ServerContext, watchers and PRD cache per worktree on demand."
  - "All module-level job trackers are keyed by workspace."
  - "Single-worktree repos behave exactly as before."
description: "Release 0.8.0 (minor) · PR 11 of 5 · packages: @n-dx/web · changeset: minor · after PR 5 and PR 8.\n\nToday packages/web/src/server/start.ts builds exactly one ServerContext { projectDir, svDir, rexDir } (types.ts) and one watcher set, PRD cache (.rex/.cache/prd.json) and set of module-level job singletons for it. In 0.8.0 the server is anchored at the repo's main worktree and holds one context per worktree (\"workspace\"), created lazily, each with its own watchers and PRD cache. The anchor is the default workspace.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:12:21.191Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Per-workspace job singletons: analyze, refresh, self-heal, ci, reshape, execution state and active executions keyed by workspace](./per-workspace-job-singletons-analyze.md) | pending |
| [Workspace registry: one ServerContext, watcher set and PRD cache per worktree, lazily created, refreshed from git worktree list](./workspace-registry-one-servercontext.md) | pending |
