---
id: "f7a6d344-fe86-4cff-b003-e1d2e1057330"
level: "task"
title: "Reverse proxy HTTP and WebSocket under /p/:id/ with viewer base-path support; root routes alias the sole registered project"
status: "completed"
priority: "high"
tags:
  - "pr-08"
  - "web"
blockedBy:
  - "e879c6ba-bcfe-4c76-821c-5972112bc49d"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-14T00:30:56.993Z"
completedAt: "2026-09-14T00:50:49.119Z"
endedAt: "2026-09-14T00:50:49.119Z"
resolutionType: "code-change"
resolutionDetail: "src/hub/proxy.ts + edge-security.ts + hub.ts routing (/p/:id/*, 308 for bare id, sole-project root alias, 409 + home page for multi-project root), viewer base-path (shared/base-path.ts, viewer/base-path.ts fetch adapter + getWsUrl + withBase, prefix-aware route parsing, 12 WS sites rewired, iso-map href), hub-proxy integration suite + base-path unit suites, @n-dx/web minor changeset. Commit 2632e93e on feat/hub-daemon-skeleton."
acceptanceCriteria:
  - "Every dashboard view works at /p/<id>/<view> including deep links and WebSocket live updates."
  - "With one registered project the existing e2e suites (cli-dev, mcp-transport, scheduler-startup) pass with the hub in front, unchanged."
  - "The viewer served directly by `web serve` (no hub) still works at /."
description: "In the hub: proxy every request under /p/:id/* to the project's child (strip the prefix, forward headers, stream bodies, handle the WebSocket upgrade by piping sockets both ways; use node:http/net directly, no new dependency). Viewer: the SPA must work under a base path: derive it from location.pathname at boot (packages/web/src/viewer/main.ts, route-state.ts, use-route-state.ts pushState), and rewrite fetch(\"/api/...\") and WebSocket URLs through one helper (packages/web/src/viewer/external.ts is the boundary gateway; add a basePath util in src/shared and use it in the messaging pipeline). Root alias: when exactly one project is registered, requests to / and /api/*, /data/*, /mcp/* are proxied to it; when several are registered, / serves the home page (PR 9) and root API calls return 409 with the list of project ids."
lastModified: "2026-09-14T00:50:49.144Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
