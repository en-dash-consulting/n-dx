---
"@n-dx/core": minor
---

New `ndx mcp <server> [dir]`: one MCP command that works whether or not the hub is running. When a hub is up and the repository is registered, it bridges stdio JSON-RPC frames to `/p/<id>/mcp/<server>` with `X-Ndx-Workspace` naming the worktree the editor was opened in, so one server per repository serves every editor, every worktree and the dashboard, and a tool call lands in the tree the editor is actually on. Otherwise it serves MCP in this process exactly as `ndx rex mcp .` always has — which is also what happens for an unregistered repository, outside a repository, or when the hub stops answering. The hub's port and project id come from the marker `ndx start` leaves in the directory, falling back to `~/.n-dx/config.json` and a registry lookup, so a hub started on a non-default port is still found. Diagnostics go to stderr only; stdout is the protocol.
