---
id: "5dd63e4e-1bbb-47a8-a0fa-754bc142a377"
type: "capability"
title: "Hot-reload MCP tool schemas on HTTP transport without server restart"
slug: "hot-reload-mcp-tool-schemas-on-http"
statement: "The HTTP MCP server serves the current rex and sourcevision tool schemas after either package is rebuilt, without a server restart and without disturbing active sessions."
criteria: [{"id":"c1","text":"When rex or sourcevision is rebuilt, the HTTP MCP server shall serve the updated tool schemas without a manual restart."},{"id":"c2","text":"When the HTTP MCP server picks up updated tool schemas, the HTTP MCP server shall serve the updated schemas to new MCP sessions."},{"id":"c3","text":"While an MCP session is active, the HTTP MCP server shall keep serving that session the tool schemas it started with."},{"id":"c4","text":"The rex MCP server shall expose a parameter in the appropriate MCP tool for every mutable PRDItem field."},{"id":"c5","text":"The edit_item MCP tool shall accept a level parameter."}]
tags:
  - "web"
  - "mcp"
  - "dx"
priority: "low"
---

The HTTP MCP server holds tool schemas in memory from startup. When rex or sourcevision are rebuilt with new/changed tool parameters, the running server still serves the old schemas. Users must restart the server to pick up changes. This is a friction point during development — stdio MCP doesn't have this problem since each invocation spawns fresh.

Options: file-watch the dist/ directories and re-initialize MCP servers on change, or add an admin endpoint to trigger reload.
