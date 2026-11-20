---
"@n-dx/core": patch
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
---

`n-dx` uses Luna, Sol 6.1 and Astra for unpinned Codex light, standard and heavy work, with matching init choices and dashboard defaults.

Action needed: To retain a previous standard execution default, set `n-dx config llm.codex.model <model-id> .`. This pins standard work only. Preserve heavy work with `n-dx config llm.tiers.codex.heavy <model-id> .` and light work with `n-dx config llm.tiers.codex.light <model-id> .` (or `n-dx config llm.codex.lightModel <model-id> .`). To retain a reviewer, set `n-dx config llm.codex.reviewModel <model-id> .`. Use the previous model ID for each slot you want to keep.

Routine review uses Sol 6.1; a saved heavy review tier uses Astra. Existing execution, tier, Hench, task and reviewer pins are preserved without rewriting saved settings. GPT-5.5 remains selectable with an API-key-only label reflecting its ChatGPT sign-in retirement.

The heavy tier pin also retains the model for saved `run.reviewTier: heavy` reviews. Such a saved tier takes precedence over `llm.codex.reviewModel`; explicit task reviewer models and CLI reviewer overrides still win.

These are workload recommendations, not n-dx benchmarks or proof of account access. Codex effort remains at client defaults pending separate effort support.
