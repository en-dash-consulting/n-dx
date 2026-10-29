---
"@n-dx/llm-client": patch
---

Repository trust: the digest now covers hench's run posture (`autonomous`, `autoCommit`, `skipFullTestGate`, `apiKeyEnv`, `claudePath`), the project config's `llm.*.cli_path`, `api_endpoint`, `llm.local.host`/`port`, `llm.google.apiKeyEnv` and `web.auth`, the assistants' project files (`.claude/settings.json`, `.claude/hooks/**`, `.codex/config.toml`) and every `run` block saved on a PRD item, each with a warning finding when it widens execution; `secret-paths-unblocked` is a warning. While the checkout is not trusted, `loadLLMConfig` and `loadClaudeConfig` ignore the tracked file's `cli_path`, `api_endpoint`, `apiKeyEnv` and local host (`.n-dx.local.json` still applies), and the API providers resolve their endpoint through one shared helper.
