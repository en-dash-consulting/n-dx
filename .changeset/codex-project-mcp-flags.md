---
"@n-dx/llm-client": patch
---

Add `codexProjectMcpDisableFlags`, `codexConfigMcpServerNames` and `CodexProjectConfigError`: a strict reader of the MCP servers a repository's `.codex/config.toml` files declare, which throws rather than skipping anything it cannot parse. `CodexTurnFlags.turnConfigFlags` adds flags computed afresh for each turn; a throw refuses the turn before anything is spawned and leaves the session usable.
