---
"@n-dx/rex": patch
"@n-dx/llm-client": patch
---

`rex mcp .` now serves the worktree named by the client's MCP roots, so a Claude desktop session in a linked worktree writes that worktree's PRD rather than the main checkout's (#499). A root naming another worktree of the same repository that has no `.rex/` refuses writes instead of falling back. An explicit directory (`rex mcp /abs/path`) and the dashboard's HTTP MCP keep the directory they were given. `get_capabilities` reports the served `workspace`. `@n-dx/llm-client` exports the shared `resolveWorkspaceFromRoots` helper.
