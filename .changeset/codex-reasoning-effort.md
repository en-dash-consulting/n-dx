---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

`llm.effort` now controls supported Codex CLI and OpenAI API reasoning effort, including agent execution and review.

Codex checks the selected client's advertised model capabilities before sending an override. Unsupported settings and unavailable capability information warn clearly. OpenAI blocking and streaming requests validate effort against model support. Without an explicit rule, existing client settings and defaults remain unchanged.
