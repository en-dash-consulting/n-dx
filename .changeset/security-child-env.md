---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
---

Every child process gets the sanitized environment (#686, #635).

- Commands the repository owns no longer see your credentials. The test gate, post-task tests, `pnpm audit` / `pnpm outdated`, requirement validation commands, the cleanup typecheck, completion validation and rex's `verify_criteria` test command now run with the same credential filter as the agent's shell (`guard.env`), instead of inheriting the whole parent environment. A `guard.env.allow` entry the repository ships (`.hench/config.json` or the `hench` section of `.n-dx.json`) reaches these commands only while you trust the repository (`ndx trust accept .`). Entries in your git-ignored `.n-dx.local.json` always apply.
- Vendor CLI environments keep each vendor mode's credentials from one table. Codex keeps the variable named by the `env_key` of the model provider your own Codex config selects (`$CODEX_HOME/config.toml`, default `~/.codex/config.toml`), so Codex on Azure OpenAI starts with its key; a repository's `.codex/config.toml` and its n-dx config are never read for it. The Gemini CLI on Vertex AI (`GOOGLE_GENAI_USE_VERTEXAI` on) keeps `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. A mode's names are kept only while that mode is active, and `ndx work` reports by name when an active mode has none of its credentials.
