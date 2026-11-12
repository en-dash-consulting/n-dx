---
"@n-dx/llm-client": patch
---

Codex turns refuse project MCP server names that cannot be disabled safely.

`codexProjectMcpDisableFlags` names the file and server when a name is not a bare TOML key (`a.b`, `my server`), instead of emitting a quoted `-c` path the Codex CLI may not honour.
