---
"@n-dx/core": patch
---

Fix `ndx plan --no-llm` not suppressing LLM calls in sourcevision zone enrichment. The flag was filtered out before being passed to `sourcevision analyze`; now maps to `--fast` (skip AI enrichment) so the full pipeline respects the flag.
