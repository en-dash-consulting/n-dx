---
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
---

Spawn the vendor CLI (Claude CLI provider) with `cwd` set to the project directory being analyzed, instead of inheriting the calling process's own cwd.

`rex analyze <dir>` and `sv analyze <dir>` (and the other LLM-assisted commands that share the same module-level client — `reorganize`, `prune`, `reshape`, `smart-add`, and the reorganize MCP tool) now call `setProjectDir(dir)` alongside `setClaudeConfig`/`setLLMConfig`, so the vendor CLI resolves its own project context (CLAUDE.md, `.mcp.json`) against the directory being analyzed rather than wherever the command was invoked from. Matches the fix already applied to the dashboard's Ask route.
