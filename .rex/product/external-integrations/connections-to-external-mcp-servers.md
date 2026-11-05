---
id: "8a7b15d7-faed-4ac0-a39d-498033396dc9"
type: "capability"
title: "Connections to external MCP servers"
slug: "connections-to-external-mcp-servers"
statement: "The product connects to MCP servers the operator adds, over HTTP or stdio, with no auth, a stored token or an OAuth sign-in, and offers their tools to the Sidecar through the action broker under each server's namespace and a per-tool read/write class and run/ask/never policy."
criteria: [{"id":"c1","text":"A connection's tools reach the Sidecar session as <id>.<tool> through the broker, never through a vendor CLI's own MCP config."},{"id":"c2","text":"A connection's token comes from the per-user credential store alone and never enters a project file, a log or a child process's environment."},{"id":"c3","text":"Reads run and writes ask by default; a never-policy tool is absent from the session; an external write is decided on a form card built from its input schema."},{"id":"c4","text":"An unreachable server reads 'connection unavailable' and the session keeps working; an expired OAuth token refreshes silently and a revoked one reads 'sign in again'."}]
---

## History

- 2026-11-05 a23959f9-b72d-4d98-ba2e-7e8e49853788 added: Sidecar connections
