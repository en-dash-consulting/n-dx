---
id: "1519783b-dcd6-43d2-b166-e410aef4c3ce"
type: "task"
title: "Per-project MCP endpoints /p/:id/mcp/rex and /p/:id/mcp/sourcevision proxied to the project server"
slug: "per-project-mcp-endpoints-p-id-mcp-rex"
description: "Route the Streamable HTTP MCP transport through the proxy: /p/:id/mcp/rex → child /mcp/rex, preserving Mcp-Session-Id, SSE responses and DELETE for session close (packages/web/src/server/routes-mcp.ts session handling stays in the child). Root /mcp/* aliases the sole project (PR 8 t2 rule). Update README MCP section: HTTP registration URL now includes the project id; note the tracked .mcp.json from PR 3 remains the recommended path."
acceptanceCriteria:
  - "tests/e2e/mcp-transport.test.js passes through the hub at both /p/<id>/mcp/rex and the root alias."
  - "Two registered projects expose independent MCP sessions; a tool call on /p/A/mcp/rex writes to A's tree only."
priority: "high"
tags:
  - "pr-08"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
blockedBy:
  - "f7a6d344-fe86-4cff-b003-e1d2e1057330"
---
