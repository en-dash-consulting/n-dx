---
"@n-dx/web": minor
---

Per-project MCP endpoints through the hub: `/p/<id>/mcp/rex` and `/p/<id>/mcp/sourcevision` are proxied to that project's server with `Mcp-Session-Id`, SSE responses, the GET event stream and `DELETE` session close carried through; the root `/mcp/*` aliases the sole registered project and answers 409 with the ids when several are registered. Two registered projects have independent sessions and write to their own trees. README's HTTP registration section now uses the per-project URL and keeps the tracked `.mcp.json` as the recommended path.
