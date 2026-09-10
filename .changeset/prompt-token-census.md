---
"@n-dx/core": patch
---

Add `scripts/prompt-census.mjs` and the checked-in prompt token baseline at
`docs/analysis/prompt-token-baseline.md`. The census measures every LLM prompt
surface across rex, sourcevision, hench, and core using llm-client's existing
`budgetPreflight()` estimator, separates fixed prompt text from per-run context,
and emits a before/after comparison against the recorded baseline.
