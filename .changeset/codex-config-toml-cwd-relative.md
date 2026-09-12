---
"@n-dx/core": minor
---

`.codex/config.toml` now uses cwd-relative stdio commands (`{"command":"n-dx","args":["rex","mcp","."]}`) instead of embedding this checkout's absolute `dist/cli/index.js` paths and project directory — matching the `.mcp.json` fix for Claude Code. Codex launches stdio servers with cwd at the project root, so both servers now start correctly from any worktree or teammate clone, and the registration survives the install moving or a dev-link toggle. The command name respects a configured `cli.name` in `.n-dx.json`.
