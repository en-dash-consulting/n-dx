---
id: "b41d7f6b-5e05-4f53-a4c6-594dc39f5303"
level: "task"
title: "Status route reports served projectDir, server version, CLI path, pid and port"
status: "pending"
priority: "high"
tags:
  - "pr-01"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "GET /api/status and GET /api/config include server.projectDir, server.version, server.cliPath, server.pid, server.port, server.startedAt."
  - "Existing consumers of both routes are unchanged (unit tests for routes-status and the config endpoint still pass)."
description: "packages/web/src/server/routes-status.ts already returns projectDir at the top level of GET /api/status. Add an additive `server` object: { projectDir, version (from @n-dx/web package.json), cliPath (process.env.NDX_CLI_PATH ?? N_DX_CLI_PATH ?? process.argv[1]), pid, port, startedAt }. Also expose the same object on GET /api/config next to scope/initialized (packages/web/src/server/start.ts handleConfigEndpoint) so the viewer footer (PR 7) can read it without the heavier status call. Purely additive; no existing field changes; document the new fields in the route's doc comment."
lastModified: "2026-09-10T20:11:32.943Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
