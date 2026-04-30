---
id: "5dd63e4e-1bbb-47a8-a0fa-754bc142a377"
level: "feature"
title: "Hot-reload MCP tool schemas on HTTP transport without server restart"
status: "completed"
priority: "low"
tags:
  - "web"
  - "mcp"
  - "dx"
startedAt: "2026-04-17T04:37:35.876Z"
completedAt: "2026-04-17T05:02:17.402Z"
resolutionType: "code-change"
resolutionDetail: "Implemented file-watching + subprocess proxy hot-reload for MCP tool schemas. Three new files + modifications to routes-mcp.ts and start.ts."
acceptanceCriteria:
  - "After rebuilding rex or sourcevision, the HTTP MCP server serves updated tool schemas without manual restart"
  - "No impact on active MCP sessions (new sessions get new schemas, existing sessions continue with their schemas)"
description: "The HTTP MCP server holds tool schemas in memory from startup. When rex or sourcevision are rebuilt with new/changed tool parameters, the running server still serves the old schemas. Users must restart the server to pick up changes. This is a friction point during development — stdio MCP doesn't have this problem since each invocation spawns fresh.\n\nOptions: file-watch the dist/ directories and re-initialize MCP servers on change, or add an admin endpoint to trigger reload."
---

# Hot-reload MCP tool schemas on HTTP transport without server restart

⚪ [completed]

## Summary

The HTTP MCP server holds tool schemas in memory from startup. When rex or sourcevision are rebuilt with new/changed tool parameters, the running server still serves the old schemas. Users must restart the server to pick up changes. This is a friction point during development — stdio MCP doesn't have this problem since each invocation spawns fresh.

Options: file-watch the dist/ directories and re-initialize MCP servers on change, or add an admin endpoint to trigger reload.

## Info

- **Status:** completed
- **Priority:** low
- **Tags:** web, mcp, dx
- **Level:** feature
- **Started:** 2026-04-17T04:37:35.876Z
- **Completed:** 2026-04-17T05:02:17.402Z
- **Duration:** 24m
