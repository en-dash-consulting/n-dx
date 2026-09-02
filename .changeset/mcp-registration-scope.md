---
"@n-dx/core": patch
---

Register MCP servers against the project being initialised, not the caller's
working directory.

`registerMcpServers` shelled out to `claude mcp remove` / `claude mcp add`
without a `cwd`, so the child inherited whatever directory the shell was in.
Local scope — the default for `claude mcp add` — is stored per-directory, so
`cd ~/repoA && ndx init ~/repoB` stripped repoA's `rex` and `sourcevision`
registrations and replaced them with entries pointing at repoB. Both the remove
loop and the add now run with `cwd` set to the resolved project directory, and
the add states `--scope local` explicitly rather than relying on the default.

This surfaced as the E2E suite destroying developers' own registrations: an
init test's temp directory ended up registered in `~/.claude.json` under the
repo the suite was launched from, leaving two MCP servers pointed at a deleted
path. Recovery for an already-clobbered config is documented in TESTING.md
under "Family 5".
