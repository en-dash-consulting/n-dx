---
id: "e879c6ba-bcfe-4c76-821c-5972112bc49d"
level: "task"
title: "Hub daemon skeleton: `web hub` command, ~/.n-dx registry and pid file, /api/hub/* routes, spawn/attach per-repo servers with health checks"
status: "pending"
priority: "high"
tags:
  - "pr-08"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
acceptanceCriteria:
  - "Integration test: start hub on a free port, POST two temp projects, both children come up, GET /api/hub/projects lists them with ports, DELETE stops one, hub shutdown stops the rest."
  - "Registry survives hub restart (children re-attached when their pid is alive, respawned otherwise)."
description: "packages/web/src/hub/ (new directory, its own zone; imports only from src/shared and node built-ins plus the llm-client exec helpers via a gateway): hub.ts entry wired as `web hub --port=3117` in packages/web/src/cli. Registry ~/.n-dx/hub.json: { projects: { [id]: { id, name, repoRoot, worktrees: [...], ndxBin, port, pid, lastSeen } } } with atomic writes. Routes: GET /api/hub/health, GET /api/hub/projects, POST /api/hub/projects { id, repoRoot, worktree, ndxBin } (spawns `<ndxBin> serve --port=0 <repoRoot>` via spawnManaged, reads the bound port from <repoRoot>/.n-dx-web.port or stdout, stores pid+port), DELETE /api/hub/projects/:id (stops the child with the child-lifecycle escalation). Health-check children every 15 s via GET /api/status; mark unreachable, respawn once. Respect the orchestration rule: core's web.js will spawn the hub (PR 10); the hub itself is web-package code and may import web modules."
lastModified: "2026-09-10T20:12:09.394Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
