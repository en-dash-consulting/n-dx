---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/core": patch
---

`n-dx` preserves explicit Codex model pins across configuration, task execution and review, including older IDs supported by API-key authentication.

Action needed: If Codex rejects a pinned model with ChatGPT authentication, explicitly select an available model in the originating setting, or configure an API key with `n-dx config credentials.codex` and select `n-dx config llm.codex.auth api` if your API project supports that model.

Model defaults no longer replace older pins. Authentication-specific model rejections explain the choice without changing settings or retrying with another model. Older IDs missing from the pricing table are reported as unknown instead of using a replacement model's rates as known prices.
