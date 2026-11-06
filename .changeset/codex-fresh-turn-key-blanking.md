---
"@n-dx/llm-client": patch
---

Codex sessions: a fresh turn always carries the overrides that blank the Codex key in the agent's commands, whatever policy flags `startVendorSession`'s caller passes. Previously only resumed turns added them, so a caller with no policy flags, or flags without the overrides, started an agent that could read `OPENAI_API_KEY` under `llm.codex.auth` `api`.
