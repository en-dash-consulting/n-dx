---
"@n-dx/llm-client": patch
---

Add an invariant test asserting every tier pointer is present in both pricing tables.

`TIER_MODELS`, `REVIEW_MODELS`, `NEWEST_MODELS` and `MODEL_ALIASES` can be
repointed at a newly released model ID without adding matching `MODEL_COSTS` and
`MODEL_CONTEXT_WINDOWS` entries. That drift is silent: `budgetPreflight` falls
back to the 128,000-token default window for what may be a 1M-context model and
returns `estimatedCostUsd` undefined. A table-driven test now iterates every
pointer in the four maps and names the offending map and key when one is
uncovered.
