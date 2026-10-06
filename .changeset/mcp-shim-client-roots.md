---
"@n-dx/core": patch
---

`ndx mcp <server>` bridging to the hub now follows the client's MCP roots (#499). When the client advertises roots, the shim asks `roots/list` after `initialized`. If the root names another worktree of the same repository, the shim re-opens the hub session for that worktree and closes the first one, so tool calls write the tree the editor is open on rather than the checkout the command started in. The client sees one session throughout. `notifications/roots/list_changed` re-targets the same way. Clients without roots, roots naming the current worktree, and roots in another repository keep the cwd-derived workspace; the last case logs one stderr line.
