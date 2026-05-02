---
id: "36e132ef-5b70-4ddd-8469-daf8be5cf497"
level: "task"
title: "MCP over HTTP transport"
status: "completed"
priority: "high"
tags:
  - "mcp"
  - "transport"
startedAt: "2026-02-10T04:53:57.230Z"
completedAt: "2026-02-10T04:53:57.230Z"
acceptanceCriteria: []
description: "Add StreamableHTTP transport to both rex and sourcevision MCP servers, mounted as endpoints on the existing web HTTP server. This enables any MCP client (not just Claude Code via stdio) to connect over HTTP. The existing stdio transport remains for backward compatibility with `claude mcp add`."
---

# MCP over HTTP transport

🟠 [completed]

## Summary

Add StreamableHTTP transport to both rex and sourcevision MCP servers, mounted as endpoints on the existing web HTTP server. This enables any MCP client (not just Claude Code via stdio) to connect over HTTP. The existing stdio transport remains for backward compatibility with `claude mcp add`.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** mcp, transport
- **Level:** task
- **Started:** 2026-02-10T04:53:57.230Z
- **Completed:** 2026-02-10T04:53:57.230Z
- **Duration:** < 1m
