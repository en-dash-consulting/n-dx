---
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

`n-dx` preflight and dashboard estimates use refreshed OpenAI rates and context metadata, including retained model pins and supported 150K-token prompts.

API maximum context is separate from Codex/Work defaults. Request estimates support published processing modes, cache durations and long-context rates; subscription usage has no inferred API bill. Aggregate estimates retain explicit assumptions and labelled unknown-model fallbacks. Model defaults and execution pins are unchanged.
