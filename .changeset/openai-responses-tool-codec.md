---
"@n-dx/llm-client": patch
---

Internal: Add a Responses API agent-turn contract for GPT-6.1 Sol and GPT-6 Astra, preserving tool identities, reasoning history, cancellation and usage.

The optional provider methods support text and function tools, including streamed turns and tool failure results. Unsupported models no longer advertise function calling. Existing text completion methods remain compatible; this does not enable direct API task execution in `n-dx work`.
