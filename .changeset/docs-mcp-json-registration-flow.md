---
"@n-dx/core": patch
---

Rewrote the MCP registration docs (README, the shared `project-guidance.md`, and `docs/guide/mcp.md`) to describe the tracked `.mcp.json` stdio flow as the default: the one-time Claude Code approval prompt for project servers, the `npx -y @n-dx/core rex mcp .` alternative when `ndx` isn't on `PATH`, and `--mcp-scope=local` for the legacy per-machine registration. HTTP transport (`http://localhost:3117/mcp/rex`) is now documented plainly as safe for a single project only — it points at whichever project currently holds the port — until the multi-project hub (0.7.0) lands.
