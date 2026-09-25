---
id: "1519783b-dcd6-43d2-b166-e410aef4c3ce"
level: "feature"
title: "Per-project MCP endpoints /p/:id/mcp/rex and /p/:id/mcp/sourcevision proxied to the project server"
status: "completed"
priority: "high"
tags:
  - "pr-08"
  - "web"
blockedBy:
  - "f7a6d344-fe86-4cff-b003-e1d2e1057330"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-16T15:49:05.382Z"
completedAt: "2026-09-16T15:51:58.360Z"
endedAt: "2026-09-16T15:51:58.360Z"
resolutionType: "code-change"
resolutionDetail: "Per-project MCP through the hub proven by a new e2e suite (prefixed endpoints, root alias, SSE, DELETE, 409, two-project session and tree isolation); JSON-RPC helper shared via e2e-helpers; README HTTP section updated to /p/<id>/mcp/* with .mcp.json still recommended."
acceptanceCriteria:
  - "tests/e2e/mcp-transport.test.js passes through the hub at both /p/<id>/mcp/rex and the root alias."
  - "Two registered projects expose independent MCP sessions; a tool call on /p/A/mcp/rex writes to A's tree only."
description: "Route the Streamable HTTP MCP transport through the proxy: /p/:id/mcp/rex → child /mcp/rex, preserving Mcp-Session-Id, SSE responses and DELETE for session close (packages/web/src/server/routes-mcp.ts session handling stays in the child). Root /mcp/* aliases the sole project (PR 8 t2 rule). Update README MCP section: HTTP registration URL now includes the project id; note the tracked .mcp.json from PR 3 remains the recommended path."
lastModified: "2026-09-16T15:51:58.733Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
