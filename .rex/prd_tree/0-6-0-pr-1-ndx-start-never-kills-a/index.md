---
id: "39ee191b-a286-4ee6-885e-85a4fc37a465"
level: "epic"
title: "0.6.0 / PR 1 · ndx start never kills a peer dashboard"
status: "pending"
priority: "critical"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-01"
  - "core"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Starting dashboards from two different project directories in sequence leaves both running; the second prints the port it fell back to."
  - "Restarting the same directory still stops and replaces its own server."
  - "tests/e2e/mcp-transport.test.js, tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js pass."
description: "Release 0.6.0 (minor) · PR 1 of 7 · packages: @n-dx/core, @n-dx/web · changeset: patch.\n\nProblem. `ndx start` (packages/core/web.js, runWeb) only knows about the pid file inside the directory it was given. A second project or a worktree has no pid file there, so a busy 3117 is read as a stranger squatting on the port and killPortOccupant() SIGKILLs it via lsof, even when the occupant is another n-dx dashboard. The server-side fallback allocator (packages/web/src/server/port.ts findAvailablePort, range 3117–3200) never runs because the orchestrator kills first.\n\nGoal. Two directories can each run `ndx start` back to back and both dashboards stay up. A dashboard is killed only when it is this directory's own stale server (the existing idempotent-restart path via the pid file).\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .` from a fresh worktree branched off main.\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:11:30.871Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [E2E test: two project directories start dashboards concurrently without killing each other](./e2e-test-two-project-directories-start.md) | pending |
| [Probe the port occupant before killing it and fall back to a free port when it is another n-dx server](./probe-the-port-occupant-before-killing.md) | completed |
| [Status route reports served projectDir, server version, CLI path, pid and port](./status-route-reports-served-projectdir.md) | pending |
