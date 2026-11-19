---
"@n-dx/hench": patch
"@n-dx/llm-client": patch
---

`n-dx work` preserves earlier context in summaries when OpenAI API runs use the default model tiers.

Compaction uses Chat Completions for the default Luna summary and keeps the Responses endpoint for existing Sol and Astra agent-model pins. Summary requests honor explicit tier, route, and effort settings. Billed tokens from a truncated or filtered Chat Completions summary count toward the run even when its text is discarded.
