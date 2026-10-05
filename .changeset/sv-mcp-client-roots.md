---
"@n-dx/sourcevision": patch
---

`sv mcp .` now serves the worktree named by the client's MCP roots, so a Claude desktop session in a linked worktree reads that worktree's `.sourcevision/` and `set_file_archetype` writes its config rather than the main checkout's (#499). A root naming another worktree of the same repository that has no `.sourcevision/` refuses `set_file_archetype`; reads fall back to the startup directory with a warning. An explicit directory (`sv mcp /abs/path`) and the dashboard's HTTP MCP keep the directory they were given. The startup directory must still hold `.sourcevision/`.
