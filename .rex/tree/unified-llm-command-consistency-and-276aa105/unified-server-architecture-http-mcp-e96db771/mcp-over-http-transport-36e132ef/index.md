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
description: "Add StreamableHTTP transport to both rex and sourcevision MCP servers, mounted as endpoints on the existing web HTTP server. This enables any MCP client (not just Claude Code via stdio) to connect over HTTP. The existing stdio transport remains for backward compatibility with `claude mcp add`."
---

## Subtask: Add StreamableHTTPServerTransport handler for rex MCP

**ID:** `79e9634f-ee12-435f-b2b2-327eb2ca5409`
**Status:** completed
**Priority:** high

Refactor `packages/rex/src/cli/mcp.ts` so the McpServer and tool registrations can be reused with either stdio or HTTP transport. Export a function that creates the server without connecting a transport, so the web server layer can mount it on a StreamableHTTPServerTransport. Keep the existing `startMcpServer()` with stdio for backward compatibility.

**Acceptance Criteria**

- Rex MCP tools work identically over HTTP and stdio
- Existing `rex mcp .` stdio command still works
- Server factory function is exported for external transport mounting

---

## Subtask: Add StreamableHTTPServerTransport handler for sourcevision MCP

**ID:** `dfa83390-2927-4ce7-8bbd-45c9b60345d1`
**Status:** completed
**Priority:** high

Same as the rex task — refactor `packages/sourcevision/src/cli/mcp.ts` so the McpServer can be mounted on either stdio or HTTP transport. Export a factory function. Keep stdio backward-compatible.

**Acceptance Criteria**

- Sourcevision MCP tools work identically over HTTP and stdio
- Existing `sv mcp .` stdio command still works
- Server factory function is exported for external transport mounting

---

## Subtask: Mount MCP endpoints on web HTTP server

**ID:** `3e31381a-d48d-4223-88f3-d9a121893d46`
**Status:** completed
**Priority:** high

In the web server (`start.ts`), add `/mcp/rex` and `/mcp/sourcevision` routes that use StreamableHTTPServerTransport from `@modelcontextprotocol/sdk`. These endpoints handle MCP JSON-RPC over HTTP alongside the existing REST API routes and static assets, all on the same port.

**Acceptance Criteria**

- MCP clients can connect to http://localhost:3117/mcp/rex
- MCP clients can connect to http://localhost:3117/mcp/sourcevision
- Existing REST API routes and viewer continue working
- CORS headers allow cross-origin MCP connections

---
