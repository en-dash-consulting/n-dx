---
"@n-dx/llm-client": patch
---

Vendor CLI environments keep each vendor mode's credentials from one table:

- Codex keeps the variable named by the `env_key` of the model provider your own
  Codex config selects (`$CODEX_HOME/config.toml`, default
  `~/.codex/config.toml`), so Codex on Azure OpenAI starts with its key. A
  repository's `.codex/config.toml` and its n-dx config are never read for it.
- The Gemini CLI on Vertex AI (`GOOGLE_GENAI_USE_VERTEXAI` on) keeps
  `GOOGLE_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT` and
  `GOOGLE_CLOUD_LOCATION`.
- A mode's names are kept only while that mode is active, and `ndx work` reports
  by name when an active mode has none of its credentials.
