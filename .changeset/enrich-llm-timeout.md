---
"@n-dx/llm-client": patch
---

Raise the per-CLI-call timeout default from 120s to 300s. Zone-enrichment and classification prompts ask the model for several KB of JSON (1.5–2.5k output tokens), and Sonnet's time-to-first-token alone can run 30–120s before generation begins. Because `--output-format json` buffers the whole response, a slow-but-legitimate completion looks like `stdout=0B` until it finishes — and a 120s cap killed many of these mid-generation, surfacing as "claude hung past 120s". The new 300s default lets them complete; `NDX_CLAUDE_PER_CALL_TIMEOUT_MS` still overrides it.
