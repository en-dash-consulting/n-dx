---
"@n-dx/llm-client": patch
---

`loadLLMConfig` now keeps `llm.claude.reviewModel`, `llm.codex.reviewModel`, `llm.google.reviewModel` and top-level `llm.reviewModel`. They were dropped on load, so a configured reviewer model was silently ignored for those vendors and `ndx work --resolve` reported the vendor default.
