---
id: "4f740491-df18-4de8-8b68-1e320f88819f"
level: "epic"
title: "0.6.0 / PR 7 · ndx which and version identity everywhere"
status: "pending"
priority: "high"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-07"
  - "core"
  - "web"
  - "hench"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "`ndx which` answers version, resolved cli.js path, install kind, git identity of the install checkout and the project dir."
  - "The dashboard footer shows the server's identity."
  - "`ndx work` prints an identity line at start."
description: "Release 0.6.0 (minor) · PR 7 of 7 · packages: @n-dx/core, @n-dx/web, @n-dx/hench · changeset: patch.\n\nProblem. The global `ndx` on a developer machine is a pnpm link to one checkout (here ~/ndx-core/ndx-stable, detached at the 0.5.2 commit), while work happens in several worktrees. `ndx --version` (packages/core/cli.js ~line 2796, handleVersion) prints only the package version, which is identical across checkouts, so nobody can tell which code a terminal, a dashboard tab, or a run record came from. The dashboard resolves its CLI through resolveNdxBin (packages/web/src/server/routes-commands.ts ~line 191: project-local node_modules/.bin → NDX_CLI_PATH → own module graph → dogfood path) and never shows the result.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:11:51.108Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Dashboard footer shows server version, install path and served project directory](./dashboard-footer-shows-server-version.md) | pending |
| [ndx which: version, resolved cli.js path, install kind, install checkout branch and SHA, project dir; --json; --version --verbose alias](./ndx-which-version-resolved-cli-js-path.md) | pending |
| [ndx work prints an identity line at start: version, cli path, project dir, branch](./ndx-work-prints-an-identity-line-at.md) | pending |
