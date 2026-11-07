---
"@n-dx/llm-client": patch
---

`codexProjectMcpDisableFlags` refuses, naming the file and the server, when a project MCP server to disable is not a bare TOML key (`a.b`, `my server`), instead of emitting a quoted `-c` path the Codex CLI may not honour.
