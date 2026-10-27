---
id: "36e132ef-5b70-4ddd-8469-daf8be5cf497"
type: "change"
title: "MCP over HTTP transport"
slug: "mcp-over-http-transport"
intent: "Add StreamableHTTP transport to both rex and sourcevision MCP servers, mounted as endpoints on the existing web HTTP server. This enables any MCP client (not just Claude Code via stdio) to connect over HTTP. The existing stdio transport remains for backward compatibility with `claude mcp add`."
touches:
  - "e96db771-5ed0-4ba8-a70b-74a30f462f65"
priority: "high"
tags:
  - "mcp"
  - "transport"
---
