---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/core": patch
---

`llm.effort` now controls supported Codex CLI and OpenAI API reasoning effort, including agent execution and review.

Codex checks the selected client's advertised model capabilities before sending an override. Unsupported settings and unavailable capability information warn clearly. OpenAI blocking and streaming requests validate effort against model support. Without an explicit rule, existing client settings and defaults remain unchanged.

`n-dx config` accepts `none`, `minimal`, and `ultra` alongside the existing effort levels, and recognizes `agent.review`. Each provider still checks support for the selected model before sending the setting.
