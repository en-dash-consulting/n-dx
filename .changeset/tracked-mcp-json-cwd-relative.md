---
"@n-dx/core": minor
---

`ndx init` now writes a tracked `.mcp.json` at the project root with cwd-relative stdio commands for rex and sourcevision (e.g. `{"command":"n-dx","args":["rex","mcp","."]}`), alongside the existing local-scope `claude mcp add` registration.

Local scope is stored in `~/.claude.json` keyed by absolute project path, so worktrees and teammate clones got no MCP registration at all, and it broke whenever the install moved or a dev link toggled. `.mcp.json` is committed to the repo instead: every worktree and clone gets the same two entries, resolved relative to whatever directory Claude Code launches the stdio server from.

Re-running `ndx init` merges into an existing `.mcp.json` rather than overwriting it — unrelated servers already present are left untouched. The command name respects a configured `cli.name` in `.n-dx.json` for projects that embed n-dx under another binary name.
