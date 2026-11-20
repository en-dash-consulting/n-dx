---
"@n-dx/llm-client": patch
---

`n-dx` sends compatible output limits when using supported OpenAI reasoning models, allowing configured reasoning effort to reach the API.

Blocking and streaming Chat Completions requests use `max_completion_tokens` for verified reasoning models, with or without explicit effort. Custom and nonreasoning models retain the legacy `max_tokens` parameter.
