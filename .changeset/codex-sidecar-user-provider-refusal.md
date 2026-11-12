---
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

Codex Sidecar sessions explain incompatible user-configured model providers before starting.

A Codex Sidecar session is refused when the user's Codex config (`$CODEX_HOME/config.toml`) selects a model provider other than `openai`, at the top level or through the selected profile: Sidecar turns skip that config, so the provider would not apply and every turn would fail auth. Create answers 400 and records nothing; a turn answers 409 and spawns nothing. A config that cannot be read refuses too. The reason names the provider and the file. Claude sessions are unaffected. llm-client exports `codexUserModelProvider` and `codexUserConfigPath`.
