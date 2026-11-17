---
"@n-dx/llm-client": patch
---

`n-dx` preserves OpenAI API cache reads and writes and requests final streaming token usage, improving usage totals and cost estimates.

Blocking and streaming responses use the same disjoint token categories. Missing, partial, malformed and interrupted accounting is explicitly identified; interrupted stream errors retain previously received usage.
