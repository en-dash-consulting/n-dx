---
"@n-dx/core": patch
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/rex": patch
---

`n-dx` uses Luna, Sol 6.1 and Astra for unpinned Codex light, standard and heavy work, with matching init choices and dashboard defaults.

Action needed: To retain a previous execution default, set `n-dx config llm.codex.model <model-id> .`; to retain a reviewer, set `n-dx config llm.codex.reviewModel <model-id> .`.

Routine review uses Sol 6.1; a saved heavy review tier uses Astra. Existing execution, tier, Hench, task and reviewer pins are preserved without rewriting saved settings. GPT-5.5 remains selectable with an API-key-only label reflecting its ChatGPT sign-in retirement.

These are workload recommendations, not n-dx benchmarks or proof of account access. Codex effort remains at client defaults pending separate effort support.
