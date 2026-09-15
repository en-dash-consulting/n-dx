---
id: "7c162aa7-95ea-4fcb-a585-4456470ce2bd"
level: "epic"
title: "0.7.0 / PR 10 · ndx start registers with the hub; --here keeps the legacy server"
status: "pending"
priority: "high"
tags:
  - "parallel-dev"
  - "release-0.7.0"
  - "pr-10"
  - "core"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "`ndx start` from any worktree registers with the hub and opens the project URL; a second repo registers beside it without a port collision."
  - "`ndx start --here` behaves exactly as 0.6.0."
  - "`ndx start stop` unregisters; the hub exits with its last project unless hub.keepAlive is set; `ndx start status` reports hub and project state."
description: "Release 0.7.0 (minor) · PR 10 of 3 · packages: @n-dx/core · changeset: minor · after PR 8.\n\n`ndx start [dir]` (packages/core/web.js runWeb) resolves the repository through the git common dir, derives a stable project id, starts the hub if it is not running, registers the project (and this worktree) and prints/opens http://localhost:3117/p/<id>/. The orchestration tier stays spawn-only: the hub is started with spawn(process.execPath, [tools.web, \"hub\", ...]) and talked to over HTTP with node:http. --here preserves today's single-project server for anyone who needs it. Compatibility: keep writing <projectDir>/.n-dx-web.port with the hub's port so `ndx refresh --live-server` (packages/core/cli.js ~line 849–875, POST /api/reload) keeps working; the hub forwards /api/reload for the sole project or, with several, for the project whose registration matches the caller's directory (send the directory in the body).\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:12:15.960Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Keep writing .n-dx-web.port in the project directory pointing at the hub so refresh --live-server and the reload signal work unchanged](./keep-writing-n-dx-web-port-in-the.md) | pending |
| [ndx start resolves the repo via the git common dir, derives the project id, starts the hub if absent, registers and opens /p/:id/](./ndx-start-resolves-the-repo-via-the.md) | pending |
| [ndx start stop unregisters the project; hub exits with its last project unless hub.keepAlive; status reports hub and project state](./ndx-start-stop-unregisters-the-project.md) | pending |
