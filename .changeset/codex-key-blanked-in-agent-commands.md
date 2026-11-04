---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/core": patch
---

Every `codex exec` n-dx spawns (agent runs, resumed runs, the cross-vendor reviewer and the auth check) now passes `-c shell_environment_policy.set.<NAME>=''` for `OPENAI_API_KEY`, `CODEX_API_KEY` and `CODEX_ACCESS_TOKEN`, so the commands the Codex agent runs see those names empty whatever `~/.codex/config.toml` sets. Codex still authenticates with the key.
