---
id: "c242e840-5159-4e2a-9856-2dcb2bc112fd"
level: "epic"
title: "0.7.0 / PR 8 · ndx hub daemon: registry, per-repo servers, reverse proxy, per-project MCP"
status: "pending"
priority: "high"
tags:
  - "parallel-dev"
  - "release-0.7.0"
  - "pr-08"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "`ndx hub` runs on 3117, registers projects, spawns or attaches a repo server per project, and proxies HTTP and WebSocket under /p/:id/."
  - "With one project registered, all root routes behave exactly as today; tests/e2e/mcp-transport.test.js passes against the root alias."
  - "Each project has MCP endpoints at /p/:id/mcp/rex and /p/:id/mcp/sourcevision."
description: "Release 0.7.0 (minor) · PR 8 of 3 · packages: @n-dx/web · changeset: minor.\n\nDesign (see the 'One Machine, Many Repos' brief, Fig. 4). A single hub process per user owns 127.0.0.1:3117 and the machine-wide concerns: a project registry in ~/.n-dx/hub.json, a pid file ~/.n-dx/hub.pid, a home page, URL routing under /p/:id/, MCP routing under /p/:id/mcp/*, and later an admission gate (PR 15). Under it, one server process per repository (today's `web serve`, unchanged) runs on an ephemeral loopback port, so every single-project assumption in the existing server stays intact and each repo can run its own n-dx version. Compatibility: while exactly one project is registered, root-level routes (including /mcp/rex and /mcp/sourcevision) proxy to it so single-project users notice nothing.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-10T20:12:08.533Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Hub daemon skeleton: `web hub` command, ~/.n-dx registry and pid file, /api/hub/* routes, spawn/attach per-repo servers with health checks](./hub-daemon-skeleton-web-hub-command-n.md) | pending |
| [Per-project MCP endpoints /p/:id/mcp/rex and /p/:id/mcp/sourcevision proxied to the project server](./per-project-mcp-endpoints-p-id-mcp-rex.md) | pending |
| [Reverse proxy HTTP and WebSocket under /p/:id/ with viewer base-path support; root routes alias the sole registered project](./reverse-proxy-http-and-websocket-under.md) | pending |
